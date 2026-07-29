import { createHash } from "node:crypto";
import path from "node:path";

import {
	itemDraft,
	itemFileDraft,
	outbox,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";

import type { EvidenceFileStorage } from "./file-storage";
import { processPdf } from "./pdf-processing";

const NATIVE_CONNECTION_KEY = "native";
const PDF_CONTENT_TYPE = "application/pdf";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export class NativeFileNotFoundError extends Error {
	constructor(itemKey: string) {
		super(`Native item file was not found: ${itemKey}`);
		this.name = "NativeFileNotFoundError";
	}
}

export class NativeFileConflictError extends Error {
	constructor(itemKey: string) {
		super(`Native item file changed concurrently: ${itemKey}`);
		this.name = "NativeFileConflictError";
	}
}

export class NativeFileValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NativeFileValidationError";
	}
}

type StageNativePdfInput = {
	expectedSha256: string;
	expectedSizeBytes: number;
	filename: string;
	itemKey: string;
	maxPdfBytes: number;
};

function normalizeStageInput(input: StageNativePdfInput) {
	const filename = input.filename.trim();
	if (
		filename.length === 0 ||
		filename.length > 255 ||
		path.basename(filename) !== filename ||
		filename === "." ||
		filename === ".."
	) {
		throw new NativeFileValidationError(
			"filename must be a plain file name with 1-255 characters",
		);
	}
	if (!filename.toLowerCase().endsWith(".pdf")) {
		throw new NativeFileValidationError("filename must end in .pdf");
	}
	if (
		!Number.isSafeInteger(input.expectedSizeBytes) ||
		input.expectedSizeBytes < 1 ||
		input.expectedSizeBytes > input.maxPdfBytes
	) {
		throw new NativeFileValidationError(
			`PDF size must be between 1 and ${input.maxPdfBytes} bytes`,
		);
	}
	const expectedSha256 = input.expectedSha256.toLowerCase();
	if (!SHA256_PATTERN.test(expectedSha256)) {
		throw new NativeFileValidationError(
			"expectedSha256 must be 64 lowercase hexadecimal characters",
		);
	}
	return {
		expectedSha256,
		expectedSizeBytes: input.expectedSizeBytes,
		filename,
	};
}

function attachmentDescriptor(
	itemKey: string,
	draftPayload: Record<string, unknown> | undefined,
	published:
		| {
				itemType: string;
				parentItem: string | null;
		  }
		| undefined,
) {
	const itemType = draftPayload?.itemType ?? published?.itemType;
	const parentItem =
		draftPayload && "parentItem" in draftPayload
			? draftPayload.parentItem
			: published?.parentItem;

	if (itemType !== "Attachment" || typeof parentItem !== "string") {
		throw new NativeFileValidationError(
			`${itemKey} must be an Attachment with a parentItem`,
		);
	}
	return { parentItem };
}

function uploadPath(
	itemKey: string,
	parentItemKey: string,
	uploadRevision: number,
) {
	return `native/${parentItemKey}/${itemKey}/draft/${uploadRevision}/file.pdf`;
}

function stagedCoverPath(pdfPath: string) {
	return pdfPath.replace(/\/file\.pdf$/u, "/cover.png");
}

function publishedPaths(itemKey: string, sha256: string) {
	const base = `native/${itemKey}/${sha256}`;
	return {
		cover: `${base}/cover.png`,
		pdf: `${base}/file.pdf`,
	};
}

function sha256(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

export async function getNativeFileState(
	db: Database,
	itemKey: string,
) {
	const [draft, publication] = await Promise.all([
		db
			.select()
			.from(itemFileDraft)
			.where(
				and(
					eq(itemFileDraft.itemKey, itemKey),
					eq(
						itemFileDraft.sourceConnectionKey,
						NATIVE_CONNECTION_KEY,
					),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select()
			.from(itemFilePublication)
			.where(
				and(
					eq(itemFilePublication.itemKey, itemKey),
					eq(
						itemFilePublication.sourceConnectionKey,
						NATIVE_CONNECTION_KEY,
					),
				),
			)
			.limit(1)
			.then((rows) => rows[0] ?? null),
	]);
	if (!draft && !publication) {
		throw new NativeFileNotFoundError(itemKey);
	}
	return { draft, publication };
}

export async function stageNativePdfUpload(
	db: Database,
	storage: EvidenceFileStorage,
	input: StageNativePdfInput,
) {
	const normalized = normalizeStageInput(input);
	const fileDraft = await db.transaction(async (transaction) => {
		const [metadataDraft, published] = await Promise.all([
			transaction
				.select({ payload: itemDraft.payload })
				.from(itemDraft)
				.where(
					and(
						eq(itemDraft.itemKey, input.itemKey),
						eq(
							itemDraft.sourceConnectionKey,
							NATIVE_CONNECTION_KEY,
						),
					),
				)
				.limit(1)
				.then((rows) => rows[0]),
			transaction
				.select({
					itemType: item.itemType,
					parentItem: item.parentItem,
				})
				.from(item)
				.where(
					and(
						eq(item.key, input.itemKey),
						eq(
							item.sourceConnectionKey,
							NATIVE_CONNECTION_KEY,
						),
					),
				)
				.limit(1)
				.then((rows) => rows[0]),
		]);
		const { parentItem } = attachmentDescriptor(
			input.itemKey,
			metadataDraft?.payload,
			published,
		);

		const [existing, publication] = await Promise.all([
			transaction
				.select()
				.from(itemFileDraft)
				.where(eq(itemFileDraft.itemKey, input.itemKey))
				.for("update")
				.limit(1)
				.then((rows) => rows[0]),
			transaction
				.select({
					uploadRevision:
						itemFilePublication.uploadRevision,
				})
				.from(itemFilePublication)
				.where(
					eq(
						itemFilePublication.itemKey,
						input.itemKey,
					),
				)
				.for("update")
				.limit(1)
				.then((rows) => rows[0]),
		]);
		if (
			existing &&
			existing.readyAt === null &&
			existing.filename === normalized.filename &&
			existing.expectedSizeBytes === normalized.expectedSizeBytes &&
			existing.expectedSha256 === normalized.expectedSha256 &&
			existing.parentItemKey === parentItem
		) {
			return existing;
		}

		const uploadRevision =
			Math.max(
				existing?.uploadRevision ?? 0,
				publication?.uploadRevision ?? 0,
			) + 1;
		const values = {
			itemKey: input.itemKey,
			sourceConnectionKey: NATIVE_CONNECTION_KEY,
			parentItemKey: parentItem,
			uploadRevision,
			objectPath: uploadPath(
				input.itemKey,
				parentItem,
				uploadRevision,
			),
			filename: normalized.filename,
			contentType: PDF_CONTENT_TYPE,
			expectedSizeBytes: normalized.expectedSizeBytes,
			expectedSha256: normalized.expectedSha256,
			actualSizeBytes: null,
			actualSha256: null,
			extractedText: null,
			coverObjectPath: null,
			coverWidth: null,
			coverHeight: null,
			pageCount: null,
			readyAt: null,
			updatedAt: new Date(),
		};

		const [saved] = existing
			? await transaction
					.update(itemFileDraft)
					.set(values)
					.where(eq(itemFileDraft.itemKey, input.itemKey))
					.returning()
			: await transaction
					.insert(itemFileDraft)
					.values(values)
					.returning();
		return saved!;
	});

	const upload = await storage.createSignedUpload(fileDraft.objectPath);
	return { fileDraft, upload };
}

export async function completeNativePdfUpload(
	db: Database,
	storage: EvidenceFileStorage,
	{
		expectedUploadRevision,
		itemKey,
		maxPdfBytes,
	}: {
		expectedUploadRevision: number;
		itemKey: string;
		maxPdfBytes: number;
	},
) {
	const [draft] = await db
		.select()
		.from(itemFileDraft)
		.where(
			and(
				eq(itemFileDraft.itemKey, itemKey),
				eq(
					itemFileDraft.sourceConnectionKey,
					NATIVE_CONNECTION_KEY,
				),
				eq(
					itemFileDraft.uploadRevision,
					expectedUploadRevision,
				),
			),
		)
		.limit(1);
	if (!draft) throw new NativeFileConflictError(itemKey);

	const bytes = await storage.downloadPrivate(draft.objectPath);
	if (bytes.byteLength > maxPdfBytes) {
		throw new NativeFileValidationError(
			`Uploaded PDF exceeds ${maxPdfBytes} bytes`,
		);
	}
	const actualSha256 = sha256(bytes);
	if (
		bytes.byteLength !== draft.expectedSizeBytes ||
		actualSha256 !== draft.expectedSha256
	) {
		throw new NativeFileValidationError(
			"Uploaded PDF does not match its declared size and SHA-256",
		);
	}

	const processed = await processPdf(bytes);
	const coverObjectPath = stagedCoverPath(draft.objectPath);
	await storage.uploadPrivate(
		coverObjectPath,
		processed.cover,
		"image/png",
	);

	const [ready] = await db
		.update(itemFileDraft)
		.set({
			actualSizeBytes: bytes.byteLength,
			actualSha256,
			extractedText: processed.text,
			coverObjectPath,
			coverWidth: processed.coverWidth,
			coverHeight: processed.coverHeight,
			pageCount: processed.pageCount,
			readyAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(itemFileDraft.itemKey, itemKey),
				eq(
					itemFileDraft.uploadRevision,
					expectedUploadRevision,
				),
				eq(itemFileDraft.objectPath, draft.objectPath),
			),
		)
		.returning();
	if (!ready) throw new NativeFileConflictError(itemKey);
	return ready;
}

export async function publishNativePdf(
	db: Database,
	storage: EvidenceFileStorage,
	{
		expectedUploadRevision,
		itemKey,
	}: {
		expectedUploadRevision: number;
		itemKey: string;
	},
) {
	const [draft] = await db
		.select()
		.from(itemFileDraft)
		.where(
			and(
				eq(itemFileDraft.itemKey, itemKey),
				eq(
					itemFileDraft.sourceConnectionKey,
					NATIVE_CONNECTION_KEY,
				),
				eq(
					itemFileDraft.uploadRevision,
					expectedUploadRevision,
				),
			),
		)
		.limit(1);
	if (
		!draft?.readyAt ||
		!draft.actualSha256 ||
		!draft.actualSizeBytes ||
		!draft.coverObjectPath ||
		!draft.coverWidth ||
		!draft.coverHeight ||
		!draft.pageCount ||
		draft.extractedText === null
	) {
		throw new NativeFileConflictError(itemKey);
	}

	const [pdfBytes, coverBytes] = await Promise.all([
		storage.downloadPrivate(draft.objectPath),
		storage.downloadPrivate(draft.coverObjectPath),
	]);
	if (
		pdfBytes.byteLength !== draft.actualSizeBytes ||
		sha256(pdfBytes) !== draft.actualSha256
	) {
		throw new NativeFileValidationError(
			"Staged PDF changed after validation",
		);
	}

	const publicPaths = publishedPaths(itemKey, draft.actualSha256);
	await Promise.all([
		storage.uploadPublic(
			publicPaths.pdf,
			pdfBytes,
			PDF_CONTENT_TYPE,
		),
		storage.uploadPublic(
			publicPaths.cover,
			coverBytes,
			"image/png",
		),
	]);
	const publicUrl = storage.publicUrl(publicPaths.pdf);
	const coverPublicUrl = storage.publicUrl(publicPaths.cover);
	const md5 = createHash("md5").update(pdfBytes).digest("hex");

	const transactionResult = await db.transaction(async (transaction) => {
		const [lockedDraft] = await transaction
			.select()
			.from(itemFileDraft)
			.where(eq(itemFileDraft.itemKey, itemKey))
			.for("update")
			.limit(1);
		if (
			!lockedDraft?.readyAt ||
			lockedDraft.uploadRevision !== expectedUploadRevision ||
			lockedDraft.actualSha256 !== draft.actualSha256
		) {
			throw new NativeFileConflictError(itemKey);
		}

		const lockedItems = await transaction
			.select()
			.from(item)
			.where(
				and(
					inArray(item.key, [
						itemKey,
						lockedDraft.parentItemKey,
					]),
					eq(
						item.sourceConnectionKey,
						NATIVE_CONNECTION_KEY,
					),
				),
			)
			.orderBy(item.key)
			.for("update")
			;
		const attachment = lockedItems.find(
			(candidate) => candidate.key === itemKey,
		);
		const parent = lockedItems.find(
			(candidate) =>
				candidate.key === lockedDraft.parentItemKey,
		);
		if (
			!attachment ||
			attachment.itemType !== "Attachment" ||
			attachment.parentItem !== lockedDraft.parentItemKey ||
			attachment.deleted === 1
		) {
			throw new NativeFileValidationError(
				"Published attachment metadata must match the staged file",
			);
		}

		if (!parent || parent.deleted === 1) {
			throw new NativeFileValidationError(
				"Attachment parent must be published",
			);
		}

		const now = new Date();
		const nextRevision = attachment.revision + 1;
		const parentNextRevision = parent.revision + 1;
		const [previousPublication] = await transaction
			.select()
			.from(itemFilePublication)
			.where(eq(itemFilePublication.itemKey, itemKey))
			.for("update")
			.limit(1);
		const [publishedItem] = await transaction
			.update(item)
			.set({
				PDFCoverPageHeight: lockedDraft.coverHeight,
				PDFCoverPageImage: coverPublicUrl,
				PDFCoverPageWidth: lockedDraft.coverWidth,
				contentType: PDF_CONTENT_TYPE,
				dateModified: now,
				filename: lockedDraft.filename,
				fullTextPDF: lockedDraft.extractedText,
				linkMode: "imported_file",
				md5,
				mtime: String(now.getTime()),
				revision: nextRevision,
				updatedAt: now,
				url: publicUrl,
			})
			.where(eq(item.key, itemKey))
			.returning();
		await transaction
			.update(item)
			.set({
				revision: parentNextRevision,
				updatedAt: now,
			})
			.where(eq(item.key, parent.key));

		const publicationValues = {
			itemKey,
			sourceConnectionKey: NATIVE_CONNECTION_KEY,
			parentItemKey: lockedDraft.parentItemKey,
			uploadRevision: lockedDraft.uploadRevision,
			revision: nextRevision,
			sourceObjectPath: lockedDraft.objectPath,
			sourceCoverObjectPath: lockedDraft.coverObjectPath!,
			objectPath: publicPaths.pdf,
			publicUrl,
			filename: lockedDraft.filename,
			contentType: PDF_CONTENT_TYPE,
			sizeBytes: lockedDraft.actualSizeBytes!,
			sha256: lockedDraft.actualSha256!,
			coverObjectPath: publicPaths.cover,
			coverPublicUrl,
			coverWidth: lockedDraft.coverWidth!,
			coverHeight: lockedDraft.coverHeight!,
			pageCount: lockedDraft.pageCount!,
			publishedAt: now,
			updatedAt: now,
		};
		await transaction
			.insert(itemFilePublication)
			.values(publicationValues)
			.onConflictDoUpdate({
				target: itemFilePublication.itemKey,
				set: publicationValues,
			});
		await transaction.insert(outbox).values([
			{
				entityType: "item",
				entityKey: itemKey,
				operation: "upsert",
				revision: nextRevision,
			},
			{
				entityType: "item",
				entityKey: parent.key,
				operation: "upsert",
				revision: parentNextRevision,
			},
		]);
		await transaction
			.delete(itemFileDraft)
			.where(eq(itemFileDraft.itemKey, itemKey));

		return {
			file: publicationValues,
			item: publishedItem!,
			previousPublicPaths: previousPublication
				? [
						previousPublication.objectPath,
						previousPublication.coverObjectPath,
					]
				: [],
		};
	});

	const stalePublicPaths =
		transactionResult.previousPublicPaths.filter(
			(path) =>
				path !== transactionResult.file.objectPath &&
				path !== transactionResult.file.coverObjectPath,
		);
	if (stalePublicPaths.length > 0) {
		try {
			await storage.removePublic(stalePublicPaths);
		} catch (error) {
			console.error(
				"Failed to remove replaced public file objects",
				error,
			);
		}
	}

	return {
		file: transactionResult.file,
		item: transactionResult.item,
	};
}

export async function unpublishNativePdf(
	db: Database,
	storage: EvidenceFileStorage,
	itemKey: string,
) {
	const result = await db.transaction(async (transaction) => {
		const [publication] = await transaction
			.select()
			.from(itemFilePublication)
			.where(
				and(
					eq(itemFilePublication.itemKey, itemKey),
					eq(
						itemFilePublication.sourceConnectionKey,
						NATIVE_CONNECTION_KEY,
					),
				),
			)
			.for("update")
			.limit(1);
		if (!publication) throw new NativeFileNotFoundError(itemKey);

		const lockedItems = await transaction
			.select()
			.from(item)
			.where(
				and(
					inArray(item.key, [
						itemKey,
						publication.parentItemKey,
					]),
					eq(
						item.sourceConnectionKey,
						NATIVE_CONNECTION_KEY,
					),
				),
			)
			.orderBy(item.key)
			.for("update");
		const attachment = lockedItems.find(
			(candidate) => candidate.key === itemKey,
		);
		const parent = lockedItems.find(
			(candidate) =>
				candidate.key === publication.parentItemKey,
		);
		if (!attachment || !parent) {
			throw new NativeFileValidationError(
				"Published file metadata is incomplete",
			);
		}

		const now = new Date();
		const attachmentRevision = attachment.revision + 1;
		const parentRevision = parent.revision + 1;
		const [updatedItem] = await transaction
			.update(item)
			.set({
				PDFCoverPageHeight: null,
				PDFCoverPageImage: null,
				PDFCoverPageWidth: null,
				contentType: null,
				dateModified: now,
				filename: null,
				fullTextPDF: null,
				linkMode: null,
				md5: null,
				mtime: null,
				revision: attachmentRevision,
				updatedAt: now,
				url: null,
			})
			.where(eq(item.key, itemKey))
			.returning();
		await transaction
			.update(item)
			.set({
				revision: parentRevision,
				updatedAt: now,
			})
			.where(eq(item.key, parent.key));
		await transaction
			.delete(itemFilePublication)
			.where(eq(itemFilePublication.itemKey, itemKey));
		await transaction.insert(outbox).values([
			{
				entityType: "item",
				entityKey: itemKey,
				operation: "upsert",
				revision: attachmentRevision,
			},
			{
				entityType: "item",
				entityKey: parent.key,
				operation: "upsert",
				revision: parentRevision,
			},
		]);

		return {
			item: updatedItem!,
			privatePaths: [
				publication.sourceObjectPath,
				publication.sourceCoverObjectPath,
			],
			publicPaths: [
				publication.objectPath,
				publication.coverObjectPath,
			],
		};
	});

	const cleanupResults = await Promise.allSettled([
		storage.removePublic(result.publicPaths),
		storage.removePrivate(result.privatePaths),
	]);
	for (const cleanup of cleanupResults) {
		if (cleanup.status === "rejected") {
			console.error(
				"Failed to remove unpublished file objects",
				cleanup.reason,
			);
		}
	}
	return result.item;
}
