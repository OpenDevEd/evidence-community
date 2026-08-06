import { createHash } from "node:crypto";

import {
	itemDraft,
	itemFileDraft,
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { itemFilePublication } from "../src/db/schema/source";
import { item } from "../src/db/schema/tables/item";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import type {
	EvidenceFileStorage,
	SignedFileUpload,
} from "../src/lib/admin/file-storage";
import {
	completeNativePdfUpload,
	discardNativePdfDraft,
	getNativeFileState,
	NativeFileConflictError,
	publishNativePdf,
	stageNativePdfUpload,
	unpublishNativePdf,
} from "../src/lib/admin/native-file-service";
import {
	createNativeItemDraft,
	getItemDraft as getNativeItemDraft,
	ItemHasPublishedFileError as NativeItemHasPublishedFileError,
	openItemDraft as openNativeItemDraft,
	publishItemDraft as publishNativeItemDraft,
	removeNativeItem,
	saveItemDraft as saveNativeItemDraft,
	unpublishNativeItem,
} from "../src/lib/admin/native-item-service";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;
const PUBLICATION_TAGS = ["publish-record"] as const;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryFileStorage implements EvidenceFileStorage {
	readonly privateFiles = new Map<string, Uint8Array>();
	readonly publicFiles = new Map<string, Uint8Array>();
	privateUploadHook: ((path: string) => Promise<void>) | null = null;
	publicUploadHook: (() => Promise<void>) | null = null;
	private publicUploadsAfterHook = 0;

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

	async uploadPrivate(path: string, data: Uint8Array, _contentType: string) {
		this.privateFiles.set(path, data.slice());
		if (this.privateUploadHook) {
			const hook = this.privateUploadHook;
			this.privateUploadHook = null;
			await hook(path);
		}
	}

	async uploadPublic(path: string, data: Uint8Array, _contentType: string) {
		this.publicFiles.set(path, data.slice());
		if (this.publicUploadHook) {
			this.publicUploadsAfterHook += 1;
			if (this.publicUploadsAfterHook === 2) {
				const hook = this.publicUploadHook;
				this.publicUploadHook = null;
				this.publicUploadsAfterHook = 0;
				await hook();
			}
		}
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
	const connectionKey = `native-file-writeback-${process.pid}-${Date.now()}`;
	let previousDefaultKeys: string[] = [];

	try {
		previousDefaultKeys = (
			await db
				.select({ key: sourceConnection.key })
				.from(sourceConnection)
				.where(eq(sourceConnection.defaultWriteback, true))
		).map(({ key }) => key);
		if (previousDefaultKeys.length > 0) {
			await db
				.update(sourceConnection)
				.set({ defaultWriteback: false })
				.where(inArray(sourceConnection.key, previousDefaultKeys));
		}
		await db.insert(sourceConnection).values({
			credentialRef: "env:NATIVE_FILE_WRITEBACK_TEST_KEY",
			defaultWriteback: true,
			externalScopeKey: connectionKey,
			key: connectionKey,
			provider: "zotero",
			scopeKind: "group",
		});

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
		const staged = await stageNativePdfUpload(db, storage, stageInput);
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
				ready.extractedText?.includes("First file publication"),
			"PDF completion did not validate and prepare the file",
		);

		const [prePublicationItem, prePublicationFile] = await Promise.all([
			db
				.select()
				.from(item)
				.where(eq(item.key, attachmentDraft.itemKey))
				.then((rows) => rows[0]),
			db
				.select()
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, attachmentDraft.itemKey))
				.then((rows) => rows[0]),
		]);
		assert(
			!prePublicationItem && !prePublicationFile,
			"Staged file leaked into published metadata",
		);

		await publishNativeItemDraft(db, parentDraft.itemKey);
		const openParentDraft = await openNativeItemDraft(
			db,
			parentDraft.itemKey,
		);
		const savedParentDraft = await saveNativeItemDraft(db, {
			itemKey: parentDraft.itemKey,
			expectedDraftRevision: openParentDraft.draftRevision,
			expectedPayload: openParentDraft.payload,
			payload: {
				...openParentDraft.payload,
				title: "Parent edit preserved across child changes",
			},
		});
		const attachmentMetadata = await publishNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			attachmentMetadata.url === null,
			"Metadata publication implicitly published the file",
		);

		const openAttachmentDraft = await openNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		const savedAttachmentDraft = await saveNativeItemDraft(db, {
			itemKey: attachmentDraft.itemKey,
			expectedDraftRevision: openAttachmentDraft.draftRevision,
			expectedPayload: openAttachmentDraft.payload,
			payload: {
				...openAttachmentDraft.payload,
				title: "Attachment edit preserved across file publish",
			},
		});
		const published = await publishNativePdf(db, storage, {
			itemKey: attachmentDraft.itemKey,
			expectedUploadRevision: ready.uploadRevision,
			publicationTags: PUBLICATION_TAGS,
		});
		const [[publishedLink], [publishedJob], publishedTags] =
			await Promise.all([
				db
					.select()
					.from(itemSourceLink)
					.where(
						and(
							eq(itemSourceLink.itemKey, attachmentDraft.itemKey),
							eq(
								itemSourceLink.sourceConnectionKey,
								connectionKey,
							),
						),
					),
				db
					.select()
					.from(sourceWritebackJob)
					.where(
						and(
							eq(
								sourceWritebackJob.itemKey,
								attachmentDraft.itemKey,
							),
							eq(sourceWritebackJob.canonicalRevision, 2),
						),
					)
					.limit(1),
				db
					.select({ name: itemToTag.tagName })
					.from(itemToTag)
					.where(eq(itemToTag.itemKey, attachmentDraft.itemKey)),
			]);
		assert(
			published.item.revision === 2 &&
				published.item.url?.includes(fileHash(pdf)) &&
				published.item.PDFCoverPageImage &&
				published.item.fullTextPDF?.includes(
					"First file publication",
				) &&
				storage.publicFiles.size === 2 &&
				publishedLink?.dirtyFields.includes("url") &&
				publishedLink.dirtyFields.includes("tags") &&
				publishedJob?.dirtyFields.includes("url") &&
				publishedJob.dirtyFields.includes("tags") &&
				publishedTags.some(({ name }) => name === PUBLICATION_TAGS[0]),
			"File publication did not project the prepared PDF",
		);
		const advancedAttachmentDraft = await getNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			advancedAttachmentDraft?.baseRevision === 2 &&
				advancedAttachmentDraft.draftRevision ===
					savedAttachmentDraft.draftRevision,
			"File publication made the open attachment draft stale",
		);

		const state = await getNativeFileState(db, attachmentDraft.itemKey);
		assert(
			state.draft === null &&
				state.publication?.uploadRevision === 1 &&
				state.publication.revision === 2,
			"Published file state is inconsistent",
		);
		const publishedPrivatePaths = new Set(storage.privateFiles.keys());
		const disposableStage = await stageNativePdfUpload(db, storage, {
			...stageInput,
			filename: "disposable.pdf",
		});
		storage.privateFiles.set(disposableStage.upload.path, pdf);
		await completeNativePdfUpload(db, storage, {
			itemKey: attachmentDraft.itemKey,
			expectedUploadRevision: disposableStage.fileDraft.uploadRevision,
			maxPdfBytes: 10_000_000,
		});
		await discardNativePdfDraft(db, storage, attachmentDraft.itemKey);
		const stateAfterDiscard = await getNativeFileState(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			stateAfterDiscard.draft === null &&
				stateAfterDiscard.publication?.uploadRevision === 1 &&
				storage.privateFiles.size === publishedPrivatePaths.size &&
				[...publishedPrivatePaths].every((objectPath) =>
					storage.privateFiles.has(objectPath),
				),
			"Discarding a staged replacement changed the publication or retained private objects",
		);

		let stalePublishRejected = false;
		try {
			await publishNativePdf(db, storage, {
				itemKey: attachmentDraft.itemKey,
				expectedUploadRevision: ready.uploadRevision,
				publicationTags: PUBLICATION_TAGS,
			});
		} catch (error) {
			stalePublishRejected = error instanceof NativeFileConflictError;
		}
		assert(stalePublishRejected, "Stale file publication was accepted");

		await saveNativeItemDraft(db, {
			itemKey: attachmentDraft.itemKey,
			expectedDraftRevision: advancedAttachmentDraft.draftRevision,
			expectedPayload: advancedAttachmentDraft.payload,
			payload: {
				...advancedAttachmentDraft.payload,
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
				republishedMetadata.fullTextPDF === published.item.fullTextPDF,
			"Metadata publication erased file-managed fields",
		);

		const replacement = await createPdf("Replacement file");
		const replacementStage = await stageNativePdfUpload(db, storage, {
			...stageInput,
			expectedSizeBytes: replacement.byteLength,
			expectedSha256: fileHash(replacement),
		});
		assert(
			replacementStage.fileDraft.uploadRevision === 2,
			"Upload revision reset after publication",
		);
		storage.privateFiles.set(replacementStage.upload.path, replacement);
		const superseding = await createPdf("Superseding staged file");
		const supersedingStage = await stageNativePdfUpload(db, storage, {
			...stageInput,
			expectedSizeBytes: superseding.byteLength,
			expectedSha256: fileHash(superseding),
		});
		assert(
			supersedingStage.fileDraft.uploadRevision === 3 &&
				!storage.privateFiles.has(replacementStage.upload.path),
			"Re-staging a PDF retained the replaced private object",
		);
		storage.privateFiles.set(supersedingStage.upload.path, superseding);
		await completeNativePdfUpload(db, storage, {
			itemKey: attachmentDraft.itemKey,
			expectedUploadRevision: supersedingStage.fileDraft.uploadRevision,
			maxPdfBytes: 10_000_000,
		});

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
			{ publicationTags: PUBLICATION_TAGS },
		);
		const [[unpublishedJob], remainingPublicationTags] = await Promise.all([
			db
				.select()
				.from(sourceWritebackJob)
				.where(
					and(
						eq(sourceWritebackJob.itemKey, attachmentDraft.itemKey),
						eq(sourceWritebackJob.canonicalRevision, 4),
					),
				)
				.limit(1),
			db
				.select({ name: itemToTag.tagName })
				.from(itemToTag)
				.where(
					and(
						eq(itemToTag.itemKey, attachmentDraft.itemKey),
						inArray(itemToTag.tagName, PUBLICATION_TAGS),
					),
				),
		]);
		assert(
			fileUnpublished.revision === 4 &&
				fileUnpublished.url === null &&
				Number(storage.publicFiles.size) === 0 &&
				unpublishedJob?.dirtyFields.includes("url") &&
				unpublishedJob.dirtyFields.includes("tags") &&
				remainingPublicationTags.length === 0,
			"File unpublish did not clear fields and public objects",
		);
		storage.publicUploadHook = async () => {
			await db
				.delete(itemFileDraft)
				.where(eq(itemFileDraft.itemKey, attachmentDraft.itemKey));
		};
		let rolledBackPublicationRejected = false;
		try {
			await publishNativePdf(db, storage, {
				itemKey: attachmentDraft.itemKey,
				expectedUploadRevision:
					supersedingStage.fileDraft.uploadRevision,
				publicationTags: PUBLICATION_TAGS,
			});
		} catch (error) {
			rolledBackPublicationRejected =
				error instanceof NativeFileConflictError;
		}
		assert(
			rolledBackPublicationRejected &&
				Number(storage.publicFiles.size) === 0,
			"Failed publication retained orphaned public objects",
		);
		const attachmentDraftAfterFileUnpublish = await openNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			attachmentDraftAfterFileUnpublish.baseRevision === 4,
			"File unpublish left the attachment draft on a stale base",
		);
		await saveNativeItemDraft(db, {
			itemKey: attachmentDraft.itemKey,
			expectedDraftRevision:
				attachmentDraftAfterFileUnpublish.draftRevision,
			expectedPayload: attachmentDraftAfterFileUnpublish.payload,
			payload: {
				...attachmentDraftAfterFileUnpublish.payload,
				title: "Attachment edit preserved across file unpublish",
			},
		});
		const attachmentAfterFileUnpublish = await publishNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			attachmentAfterFileUnpublish.revision === 5 &&
				attachmentAfterFileUnpublish.title ===
					"Attachment edit preserved across file unpublish",
			"Attachment draft could not publish after file unpublish",
		);
		const metadataUnpublished = await unpublishNativeItem(
			db,
			attachmentDraft.itemKey,
		);
		assert(
			metadataUnpublished.deleted === 1 &&
				metadataUnpublished.revision === 6,
			"Attachment metadata did not unpublish after its file",
		);
		const [advancedParentDraft] = await db
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, parentDraft.itemKey));
		assert(
			advancedParentDraft?.baseRevision === 7 &&
				advancedParentDraft.draftRevision ===
					savedParentDraft.draftRevision,
			"Child changes made the open parent draft stale",
		);
		const republishedParent = await publishNativeItemDraft(
			db,
			parentDraft.itemKey,
		);
		assert(
			republishedParent.revision === 8 &&
				republishedParent.title ===
					"Parent edit preserved across child changes",
			"Parent draft did not preserve edits across child changes",
		);

		const concurrentParentDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Concurrent file parent",
		});
		const concurrentAttachmentDraft = await createNativeItemDraft(db, {
			itemType: "Attachment",
			parentItem: concurrentParentDraft.itemKey,
			title: "Concurrent file attachment",
		});
		createdKeys.push(
			concurrentParentDraft.itemKey,
			concurrentAttachmentDraft.itemKey,
		);
		const concurrentInitialStage = await stageNativePdfUpload(db, storage, {
			itemKey: concurrentAttachmentDraft.itemKey,
			filename: "concurrent.pdf",
			expectedSizeBytes: pdf.byteLength,
			expectedSha256: fileHash(pdf),
			maxPdfBytes: 10_000_000,
		});
		storage.privateFiles.set(concurrentInitialStage.upload.path, pdf);
		const concurrentInitialReady = await completeNativePdfUpload(
			db,
			storage,
			{
				itemKey: concurrentAttachmentDraft.itemKey,
				expectedUploadRevision:
					concurrentInitialStage.fileDraft.uploadRevision,
				maxPdfBytes: 10_000_000,
			},
		);
		await publishNativeItemDraft(db, concurrentParentDraft.itemKey);
		await publishNativeItemDraft(db, concurrentAttachmentDraft.itemKey);
		await publishNativePdf(db, storage, {
			itemKey: concurrentAttachmentDraft.itemKey,
			expectedUploadRevision: concurrentInitialReady.uploadRevision,
			publicationTags: PUBLICATION_TAGS,
		});
		const concurrentReplacementStage = await stageNativePdfUpload(
			db,
			storage,
			{
				itemKey: concurrentAttachmentDraft.itemKey,
				filename: "concurrent-replacement.pdf",
				expectedSizeBytes: pdf.byteLength,
				expectedSha256: fileHash(pdf),
				maxPdfBytes: 10_000_000,
			},
		);
		storage.privateFiles.set(concurrentReplacementStage.upload.path, pdf);
		const concurrentReplacementReady = await completeNativePdfUpload(
			db,
			storage,
			{
				itemKey: concurrentAttachmentDraft.itemKey,
				expectedUploadRevision:
					concurrentReplacementStage.fileDraft.uploadRevision,
				maxPdfBytes: 10_000_000,
			},
		);
		const concurrentFileMutations = await Promise.allSettled([
			publishNativePdf(db, storage, {
				itemKey: concurrentAttachmentDraft.itemKey,
				expectedUploadRevision:
					concurrentReplacementReady.uploadRevision,
				publicationTags: PUBLICATION_TAGS,
			}),
			unpublishNativePdf(db, storage, concurrentAttachmentDraft.itemKey, {
				publicationTags: PUBLICATION_TAGS,
			}),
		]);
		assert(
			concurrentFileMutations.every(
				(result) => result.status === "fulfilled",
			),
			"Concurrent PDF publish and unpublish deadlocked or failed",
		);
		const [remainingConcurrentPublication] = await db
			.select({ itemKey: itemFilePublication.itemKey })
			.from(itemFilePublication)
			.where(
				eq(
					itemFilePublication.itemKey,
					concurrentAttachmentDraft.itemKey,
				),
			);
		if (remainingConcurrentPublication) {
			await unpublishNativePdf(
				db,
				storage,
				concurrentAttachmentDraft.itemKey,
				{ publicationTags: PUBLICATION_TAGS },
			);
		}
		assert(
			Number(storage.publicFiles.size) === 0,
			"File lifecycle retained public objects after cleanup",
		);
		assert(
			Number(storage.privateFiles.size) === 0,
			"File lifecycle retained private objects after cleanup",
		);
		const conflictingParentDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Conflicting completion parent",
		});
		const conflictingAttachmentDraft = await createNativeItemDraft(db, {
			itemType: "Attachment",
			parentItem: conflictingParentDraft.itemKey,
			title: "Conflicting completion attachment",
		});
		createdKeys.push(
			conflictingParentDraft.itemKey,
			conflictingAttachmentDraft.itemKey,
		);
		const conflictingStage = await stageNativePdfUpload(db, storage, {
			itemKey: conflictingAttachmentDraft.itemKey,
			filename: "conflicting-completion.pdf",
			expectedSizeBytes: pdf.byteLength,
			expectedSha256: fileHash(pdf),
			maxPdfBytes: 10_000_000,
		});
		storage.privateFiles.set(conflictingStage.upload.path, pdf);
		let conflictedCoverPath = "";
		storage.privateUploadHook = async (coverPath) => {
			conflictedCoverPath = coverPath;
			await db
				.delete(itemFileDraft)
				.where(
					eq(
						itemFileDraft.itemKey,
						conflictingAttachmentDraft.itemKey,
					),
				);
		};
		let completionConflictRejected = false;
		try {
			await completeNativePdfUpload(db, storage, {
				itemKey: conflictingAttachmentDraft.itemKey,
				expectedUploadRevision:
					conflictingStage.fileDraft.uploadRevision,
				maxPdfBytes: 10_000_000,
			});
		} catch (error) {
			completionConflictRejected =
				error instanceof NativeFileConflictError;
		}
		assert(
			completionConflictRejected &&
				Boolean(conflictedCoverPath) &&
				!storage.privateFiles.has(conflictedCoverPath),
			"Conflicted PDF completion retained an orphaned cover",
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
				"upsert:1,upsert:2,upsert:3,upsert:4,upsert:5,delete:6",
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
				"upsert:1,upsert:2,upsert:3,upsert:4,upsert:5,upsert:6,upsert:7,upsert:8",
			"Parent projection revisions did not follow attachment changes",
		);

		const removalParent = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Staged-file removal parent",
		});
		const removalAttachment = await createNativeItemDraft(db, {
			itemType: "Attachment",
			parentItem: removalParent.itemKey,
			title: "Staged-file removal attachment",
		});
		createdKeys.push(removalParent.itemKey, removalAttachment.itemKey);
		await publishNativeItemDraft(db, removalParent.itemKey);
		await publishNativeItemDraft(db, removalAttachment.itemKey);
		await openNativeItemDraft(db, removalAttachment.itemKey);
		const removalStage = await stageNativePdfUpload(db, storage, {
			...stageInput,
			itemKey: removalAttachment.itemKey,
		});
		storage.privateFiles.set(removalStage.upload.path, pdf);
		const removedWithStage = await removeNativeItem(
			db,
			removalAttachment.itemKey,
		);
		await storage.removePrivate(removedWithStage.stagedPrivatePaths);
		const [
			[removedMetadataDraft],
			[removedFileDraft],
			[removedPublication],
		] = await Promise.all([
			db
				.select({ itemKey: itemDraft.itemKey })
				.from(itemDraft)
				.where(eq(itemDraft.itemKey, removalAttachment.itemKey))
				.limit(1),
			db
				.select({ itemKey: itemFileDraft.itemKey })
				.from(itemFileDraft)
				.where(eq(itemFileDraft.itemKey, removalAttachment.itemKey))
				.limit(1),
			db
				.select({ deleted: item.deleted })
				.from(item)
				.where(eq(item.key, removalAttachment.itemKey))
				.limit(1),
		]);
		assert(
			removedWithStage.changed &&
				removedWithStage.stagedPrivatePaths.includes(
					removalStage.upload.path,
				) &&
				!removedMetadataDraft &&
				!removedFileDraft &&
				removedPublication?.deleted === 1 &&
				!storage.privateFiles.has(removalStage.upload.path),
			"Record removal retained staged metadata or PDF state",
		);

		console.log(
			JSON.stringify({
				attachmentKey: attachmentDraft.itemKey,
				fileRevision: state.publication.revision,
				nextUploadRevision: supersedingStage.fileDraft.uploadRevision,
				attachmentOutboxEvents: attachmentEvents.length,
				parentOutboxEvents: parentEvents.length,
				concurrentFileMutations: concurrentFileMutations.length,
				publicObjects: storage.publicFiles.size,
				stagedRemovalVerified: true,
			}),
		);
	} finally {
		if (createdKeys.length > 0) {
			await db
				.delete(sourceWritebackJob)
				.where(inArray(sourceWritebackJob.itemKey, createdKeys));
			await db
				.delete(itemSourceLink)
				.where(inArray(itemSourceLink.itemKey, createdKeys));
			await db
				.delete(outbox)
				.where(inArray(outbox.entityKey, createdKeys));
			await db
				.delete(itemFileDraft)
				.where(inArray(itemFileDraft.itemKey, createdKeys));
			await db
				.delete(itemFilePublication)
				.where(inArray(itemFilePublication.itemKey, createdKeys));
			await db.delete(item).where(inArray(item.key, createdKeys));
			await db
				.delete(itemDraft)
				.where(inArray(itemDraft.itemKey, createdKeys));
			await db
				.delete(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, "native"),
						inArray(itemIdentity.key, createdKeys),
					),
				);
		}
		await db
			.delete(sourceConnection)
			.where(eq(sourceConnection.key, connectionKey));
		if (previousDefaultKeys.length > 0) {
			await db
				.update(sourceConnection)
				.set({ defaultWriteback: true })
				.where(inArray(sourceConnection.key, previousDefaultKeys));
		}
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
