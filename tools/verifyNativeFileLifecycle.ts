import { createHash } from "node:crypto";

import {
	itemDraft,
	itemFileDraft,
	itemIdentity,
	outbox,
} from "@opendeved/evidence-library-core";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { itemFilePublication } from "../src/db/schema/source";
import { item } from "../src/db/schema/tables/item";
import type {
	EvidenceFileStorage,
	SignedFileUpload,
} from "../src/lib/admin/file-storage";
import {
	completeNativePdfUpload,
	getNativeFileState,
	NativeFileConflictError,
	publishNativePdf,
	stageNativePdfUpload,
	unpublishNativePdf,
} from "../src/lib/admin/native-file-service";
import {
	createNativeItemDraft,
	NativeItemHasPublishedFileError,
	openNativeItemDraft,
	publishNativeItemDraft,
	saveNativeItemDraft,
	unpublishNativeItem,
} from "../src/lib/admin/native-item-service";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryFileStorage implements EvidenceFileStorage {
	readonly privateFiles = new Map<string, Uint8Array>();
	readonly publicFiles = new Map<string, Uint8Array>();

	async createSignedUpload(path: string): Promise<SignedFileUpload> {
		return {
			path,
			signedUrl: `http://storage.local/upload/${path}`,
			token: `token-${path}`,
		};
	}

	async downloadPrivate(path: string) {
		const data = this.privateFiles.get(path);
		if (!data) throw new Error(`Missing private object: ${path}`);
		return data.slice();
	}

	async uploadPrivate(
		path: string,
		data: Uint8Array,
		_contentType: string,
	) {
		this.privateFiles.set(path, data.slice());
	}

	async uploadPublic(
		path: string,
		data: Uint8Array,
		_contentType: string,
	) {
		this.publicFiles.set(path, data.slice());
	}

	publicUrl(path: string) {
		return `http://storage.local/public/${path}`;
	}

	async removePrivate(paths: string[]) {
		for (const path of paths) this.privateFiles.delete(path);
	}

	async removePublic(paths: string[]) {
		for (const path of paths) this.publicFiles.delete(path);
	}
}

async function createPdf(title: string) {
	const document = await PDFDocument.create();
	const font = await document.embedFont(StandardFonts.Helvetica);
	const page = document.addPage([612, 792]);
	page.drawText(title, { x: 72, y: 700, size: 24, font });
	page.drawText("Evidence Library file lifecycle verification.", {
		x: 72,
		y: 660,
		size: 12,
		font,
	});
	return new Uint8Array(await document.save());
}

function fileHash(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = resource.database;
	const storage = new MemoryFileStorage();
	const createdKeys: string[] = [];

	try {
		const parentDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Parent report",
		});
		const attachmentDraft = await createNativeItemDraft(db, {
			itemType: "Attachment",
			parentItem: parentDraft.itemKey,
			title: "Draft PDF",
		});
		createdKeys.push(parentDraft.itemKey, attachmentDraft.itemKey);

		const pdf = await createPdf("First file publication");
		const stageInput = {
			itemKey: attachmentDraft.itemKey,
			filename: "evidence.pdf",
			expectedSizeBytes: pdf.byteLength,
			expectedSha256: fileHash(pdf),
			maxPdfBytes: 10_000_000,
		};
		const staged = await stageNativePdfUpload(
			db,
			storage,
			stageInput,
		);
		const retriedStage = await stageNativePdfUpload(
			db,
			storage,
			stageInput,
		);
		assert(
			retriedStage.fileDraft.uploadRevision ===
				staged.fileDraft.uploadRevision &&
				retriedStage.fileDraft.objectPath ===
					staged.fileDraft.objectPath,
			"Identical pending stage request did not converge",
		);

		storage.privateFiles.set(staged.upload.path, pdf);
		const ready = await completeNativePdfUpload(db, storage, {
			itemKey: attachmentDraft.itemKey,
			expectedUploadRevision: staged.fileDraft.uploadRevision,
			maxPdfBytes: 10_000_000,
		});
		assert(
			ready.readyAt &&
				ready.pageCount === 1 &&
				ready.coverWidth === 1600 &&
				ready.extractedText?.includes(
					"First file publication",
				),
			"PDF completion did not validate and prepare the file",
		);

		const [prePublicationItem, prePublicationFile] =
			await Promise.all([
				db
					.select()
					.from(item)
					.where(eq(item.key, attachmentDraft.itemKey))
					.then((rows) => rows[0]),
				db
					.select()
					.from(itemFilePublication)
					.where(
						eq(
							itemFilePublication.itemKey,
							attachmentDraft.itemKey,
						),
					)
					.then((rows) => rows[0]),
			]);
		assert(
			!prePublicationItem && !prePublicationFile,
			"Staged file leaked into published metadata",
		);

		await publishNativeItemDraft(db, parentDraft.itemKey);
		const attachmentMetadata = await publishNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			attachmentMetadata.url === null,
			"Metadata publication implicitly published the file",
		);

		const published = await publishNativePdf(db, storage, {
			itemKey: attachmentDraft.itemKey,
			expectedUploadRevision: ready.uploadRevision,
		});
		assert(
			published.item.revision === 2 &&
				published.item.url?.includes(fileHash(pdf)) &&
				published.item.PDFCoverPageImage &&
				published.item.fullTextPDF?.includes(
					"First file publication",
				) &&
				storage.publicFiles.size === 2,
			"File publication did not project the prepared PDF",
		);

		const state = await getNativeFileState(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			state.draft === null &&
				state.publication?.uploadRevision === 1 &&
				state.publication.revision === 2,
			"Published file state is inconsistent",
		);

		let stalePublishRejected = false;
		try {
			await publishNativePdf(db, storage, {
				itemKey: attachmentDraft.itemKey,
				expectedUploadRevision: ready.uploadRevision,
			});
		} catch (error) {
			stalePublishRejected =
				error instanceof NativeFileConflictError;
		}
		assert(stalePublishRejected, "Stale file publication was accepted");

		const metadataDraft = await openNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		await saveNativeItemDraft(db, {
			itemKey: attachmentDraft.itemKey,
			expectedDraftRevision: metadataDraft.draftRevision,
			payload: {
				...metadataDraft.payload,
				title: "Renamed PDF metadata",
			},
		});
		const republishedMetadata = await publishNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			republishedMetadata.revision === 3 &&
				republishedMetadata.url === published.item.url &&
				republishedMetadata.PDFCoverPageImage ===
					published.item.PDFCoverPageImage &&
				republishedMetadata.fullTextPDF ===
					published.item.fullTextPDF,
			"Metadata publication erased file-managed fields",
		);

		const replacement = await createPdf("Replacement file");
		const replacementStage = await stageNativePdfUpload(
			db,
			storage,
			{
				...stageInput,
				expectedSizeBytes: replacement.byteLength,
				expectedSha256: fileHash(replacement),
			},
		);
		assert(
			replacementStage.fileDraft.uploadRevision === 2,
			"Upload revision reset after publication",
		);

		let metadataUnpublishRejected = false;
		try {
			await unpublishNativeItem(db, attachmentDraft.itemKey);
		} catch (error) {
			metadataUnpublishRejected =
				error instanceof NativeItemHasPublishedFileError;
		}
		assert(
			metadataUnpublishRejected,
			"Attachment metadata was unpublished while its PDF was public",
		);

		const fileUnpublished = await unpublishNativePdf(
			db,
			storage,
			attachmentDraft.itemKey,
		);
		assert(
			fileUnpublished.revision === 4 &&
				fileUnpublished.url === null &&
				Number(storage.publicFiles.size) === 0,
			"File unpublish did not clear fields and public objects",
		);
		const metadataUnpublished = await unpublishNativeItem(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			metadataUnpublished.deleted === 1 &&
				metadataUnpublished.revision === 5,
			"Attachment metadata did not unpublish after its file",
		);

		const attachmentEvents = await db
			.select()
			.from(outbox)
			.where(eq(outbox.entityKey, attachmentDraft.itemKey))
			.orderBy(outbox.id);
		assert(
			attachmentEvents
				.map(({ operation, revision }) => `${operation}:${revision}`)
				.join(",") ===
				"upsert:1,upsert:2,upsert:3,upsert:4,delete:5",
			"Attachment lifecycle emitted the wrong outbox sequence",
		);
		const parentEvents = await db
			.select()
			.from(outbox)
			.where(eq(outbox.entityKey, parentDraft.itemKey))
			.orderBy(outbox.id);
		assert(
			parentEvents
				.map(({ operation, revision }) => `${operation}:${revision}`)
				.join(",") ===
				"upsert:1,upsert:2,upsert:3,upsert:4,upsert:5,upsert:6",
			"Parent projection revisions did not follow attachment changes",
		);

		console.log(
			JSON.stringify({
				attachmentKey: attachmentDraft.itemKey,
				fileRevision: state.publication.revision,
				nextUploadRevision:
					replacementStage.fileDraft.uploadRevision,
				attachmentOutboxEvents: attachmentEvents.length,
				parentOutboxEvents: parentEvents.length,
				publicObjects: storage.publicFiles.size,
			}),
		);
	} finally {
		if (createdKeys.length > 0) {
			await db
				.delete(outbox)
				.where(inArray(outbox.entityKey, createdKeys));
			await db
				.delete(itemFileDraft)
				.where(inArray(itemFileDraft.itemKey, createdKeys));
			await db
				.delete(itemFilePublication)
				.where(
					inArray(
						itemFilePublication.itemKey,
						createdKeys,
					),
				);
			await db.delete(item).where(inArray(item.key, createdKeys));
			await db
				.delete(itemDraft)
				.where(inArray(itemDraft.itemKey, createdKeys));
			await db
				.delete(itemIdentity)
				.where(
					and(
						eq(
							itemIdentity.sourceConnectionKey,
							"native",
						),
						inArray(itemIdentity.key, createdKeys),
					),
				);
		}
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
