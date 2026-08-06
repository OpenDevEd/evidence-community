import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
	itemDraft,
	itemFileDraft,
	outbox,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { lockItemMutations } from "@/db/item-mutation-lock";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { tag } from "@/db/schema/tables/tag";
import {
	ensureDefaultWritebackLink,
	markItemWritebackDirty,
} from "@/lib/source-writeback/queue";

import type { EvidenceFileStorage } from "./file-storage";
import { advanceOpenItemDraftBaseRevision as advanceOpenNativeDraftBaseRevision } from "./native-item-service";
import { processPdf } from "./pdf-processing";
import { NATIVE_SOURCE_CONNECTION_KEY as NATIVE_CONNECTION_KEY } from "./constants";
import { AdminValidationError, type AdminFieldErrors } from "./errors";
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

export class NativeFileValidationError extends AdminValidationError {
	constructor(message: string, fields: AdminFieldErrors = {}) {
		super(message, fields);
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

function normalizePublicationTags(values: readonly string[]) {
	const tags = [...new Set(values.map((value) => value.trim()))].filter(
		Boolean,
	);
	if (tags.length === 0) {
		throw new NativeFileValidationError(
			"PDF publication is not configured.",
			{
				file: "Configure at least one PDF publication tag, then try again.",
			},
		);
	}
	return tags.sort();
}

function normalizeStageInput(input: StageNativePdfInput) {
	const filename = input.filename.trim();
	if (
		filename.length === 0 ||
		filename.length > 255 ||
		path.basename(filename) !== filename ||
		filename === "." ||
		filename === ".."
	) {
		throw new NativeFileValidationError("Choose another PDF.", {
			file: "The PDF name must be between 1 and 255 characters and cannot contain folders.",
		});
	}
	if (!filename.toLowerCase().endsWith(".pdf")) {
		throw new NativeFileValidationError("Choose a PDF file.", {
			file: "The selected file must have a .pdf extension.",
		});
	}
	if (
		!Number.isSafeInteger(input.expectedSizeBytes) ||
		input.expectedSizeBytes < 1 ||
		input.expectedSizeBytes > input.maxPdfBytes
	) {
		throw new NativeFileValidationError("Choose another PDF.", {
			file:
				input.expectedSizeBytes < 1
					? "The selected PDF is empty."
					: `This PDF is larger than the ${Math.floor(input.maxPdfBytes / 1024 / 1024)} MB upload limit.`,
		});
	}
	const expectedSha256 = input.expectedSha256.toLowerCase();
	if (!SHA256_PATTERN.test(expectedSha256)) {
		throw new NativeFileValidationError(
			"The PDF could not be prepared for upload.",
			{
				file: "Choose the file again and retry the upload.",
			},
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
			"Create an attachment before uploading a PDF.",
			{
				file: "PDFs can only be uploaded to an attachment linked to a parent record.",
			},
		);
	}
	return { parentItem };
}

function uploadPath(
	itemKey: string,
	parentItemKey: string,
	uploadRevision: number,
) {
	return `native/${parentItemKey}/${itemKey}/draft/${uploadRevision}-${randomUUID()}/file.pdf`;
}

function stagedCoverPath(pdfPath: string) {
	return pdfPath.replace(/\/file\.pdf$/u, "/cover.png");
}

function publishedPaths(itemKey: string, sha256: string) {
	const base = `native/${itemKey}/published/${randomUUID()}-${sha256}`;
	return {
		cover: `${base}/cover.png`,
		pdf: `${base}/file.pdf`,
	};
}

function sha256(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

export async function getNativeFileState(db: Database, itemKey: string) {
	return db.transaction(
		async (transaction) => {
			const [draft] = await transaction
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
				.limit(1);
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
				.limit(1);
			if (!draft && !publication) {
				throw new NativeFileNotFoundError(itemKey);
			}
			return {
				draft: draft ?? null,
				publication: publication ?? null,
			};
		},
		{
			accessMode: "read only",
			isolationLevel: "repeatable read",
		},
	);
}

export async function stageNativePdfUpload(
	db: Database,
	storage: EvidenceFileStorage,
	input: StageNativePdfInput,
) {
	const normalized = normalizeStageInput(input);
	const staged = await db.transaction(async (transaction) => {
		const [metadataDraft] = await transaction
			.select({ patch: itemDraft.patch })
			.from(itemDraft)
			.where(
				and(
					eq(itemDraft.itemKey, input.itemKey),
					eq(itemDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.limit(1);
		const [published] = await transaction
			.select({
				itemType: item.itemType,
				parentItem: item.parentItem,
			})
			.from(item)
			.where(
				and(
					eq(item.key, input.itemKey),
					eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.limit(1);
		const { parentItem } = attachmentDescriptor(
			input.itemKey,
			metadataDraft?.patch,
			published,
		);

		const [existing] = await transaction
			.select()
			.from(itemFileDraft)
			.where(eq(itemFileDraft.itemKey, input.itemKey))
			.for("update")
			.limit(1);
		const [publication] = await transaction
			.select({
				uploadRevision: itemFilePublication.uploadRevision,
			})
			.from(itemFilePublication)
			.where(eq(itemFilePublication.itemKey, input.itemKey))
			.for("update")
			.limit(1);
		if (
			existing &&
			existing.readyAt === null &&
			existing.filename === normalized.filename &&
			existing.expectedSizeBytes === normalized.expectedSizeBytes &&
			existing.expectedSha256 === normalized.expectedSha256 &&
			existing.parentItemKey === parentItem
		) {
			return { fileDraft: existing, stalePrivatePaths: [] };
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
			objectPath: uploadPath(input.itemKey, parentItem, uploadRevision),
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
		return {
			fileDraft: saved!,
			stalePrivatePaths: existing
				? [existing.objectPath, existing.coverObjectPath].filter(
						(objectPath): objectPath is string =>
							Boolean(objectPath) &&
							objectPath !== saved!.objectPath &&
							objectPath !== saved!.coverObjectPath,
					)
				: [],
		};
	});

	if (staged.stalePrivatePaths.length > 0) {
		try {
			await storage.removePrivate(staged.stalePrivatePaths);
		} catch (error) {
			console.error(
				"Failed to remove replaced staged file objects",
				error,
			);
		}
	}
	const upload = await storage.createSignedUpload(
		staged.fileDraft.objectPath,
	);
	return { fileDraft: staged.fileDraft, upload };
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
				eq(itemFileDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				eq(itemFileDraft.uploadRevision, expectedUploadRevision),
			),
		)
		.limit(1);
	if (!draft) throw new NativeFileConflictError(itemKey);

	const bytes = await storage.downloadPrivate(draft.objectPath);
	if (bytes.byteLength > maxPdfBytes) {
		throw new NativeFileValidationError("Choose another PDF.", {
			file: `This PDF is larger than the ${Math.floor(maxPdfBytes / 1024 / 1024)} MB upload limit.`,
		});
	}
	const actualSha256 = sha256(bytes);
	if (
		bytes.byteLength !== draft.expectedSizeBytes ||
		actualSha256 !== draft.expectedSha256
	) {
		throw new NativeFileValidationError("The PDF upload was incomplete.", {
			file: "Choose the file again and retry the upload.",
		});
	}

	const processed = await processPdf(bytes);
	const coverObjectPath = stagedCoverPath(draft.objectPath);
	await storage.uploadPrivate(coverObjectPath, processed.cover, "image/png");

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
				eq(itemFileDraft.uploadRevision, expectedUploadRevision),
				eq(itemFileDraft.objectPath, draft.objectPath),
			),
		)
		.returning();
	if (!ready) {
		try {
			await storage.removePrivate([coverObjectPath]);
		} catch (error) {
			console.error(
				"Failed to remove cover after upload completion conflict",
				error,
			);
		}
		throw new NativeFileConflictError(itemKey);
	}
	return ready;
}

export async function discardNativePdfDraft(
	db: Database,
	storage: EvidenceFileStorage,
	itemKey: string,
) {
	const privatePaths = await db.transaction(async (transaction) => {
		const [draft] = await transaction
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
			.for("update")
			.limit(1);
		if (!draft) throw new NativeFileNotFoundError(itemKey);

		await transaction
			.delete(itemFileDraft)
			.where(eq(itemFileDraft.itemKey, itemKey));
		return [draft.objectPath, draft.coverObjectPath].filter(
			(objectPath): objectPath is string => Boolean(objectPath),
		);
	});

	try {
		await storage.removePrivate(privatePaths);
	} catch (error) {
		console.error("Failed to remove discarded staged file objects", error);
	}
}

export async function publishNativePdf(
	db: Database,
	storage: EvidenceFileStorage,
	{
		expectedUploadRevision,
		itemKey,
		publicationTags,
	}: {
		expectedUploadRevision: number;
		itemKey: string;
		publicationTags: readonly string[];
	},
) {
	const normalizedPublicationTags = normalizePublicationTags(publicationTags);
	const [draft] = await db
		.select()
		.from(itemFileDraft)
		.where(
			and(
				eq(itemFileDraft.itemKey, itemKey),
				eq(itemFileDraft.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				eq(itemFileDraft.uploadRevision, expectedUploadRevision),
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
			"The staged PDF could not be published.",
			{
				file: "Upload the PDF again, then retry publishing.",
			},
		);
	}

	const publicPaths = publishedPaths(itemKey, draft.actualSha256);
	await Promise.all([
		storage.uploadPublic(publicPaths.pdf, pdfBytes, PDF_CONTENT_TYPE),
		storage.uploadPublic(publicPaths.cover, coverBytes, "image/png"),
	]);
	const publicUrl = storage.publicUrl(publicPaths.pdf);
	const coverPublicUrl = storage.publicUrl(publicPaths.cover);
	const md5 = createHash("md5").update(pdfBytes).digest("hex");

	const commitPublication = () =>
		db.transaction(async (transaction) => {
			await lockItemMutations(transaction, [
				itemKey,
				draft.parentItemKey,
			]);
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
			if (lockedDraft.parentItemKey !== draft.parentItemKey) {
				throw new NativeFileConflictError(itemKey);
			}

			const lockedItems = await transaction
				.select()
				.from(item)
				.where(
					and(
						inArray(item.key, [itemKey, lockedDraft.parentItemKey]),
						eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY),
					),
				)
				.orderBy(item.key)
				.for("update");
			const attachment = lockedItems.find(
				(candidate) => candidate.key === itemKey,
			);
			const parent = lockedItems.find(
				(candidate) => candidate.key === lockedDraft.parentItemKey,
			);
			if (
				!attachment ||
				attachment.itemType !== "Attachment" ||
				attachment.parentItem !== lockedDraft.parentItemKey ||
				attachment.deleted === 1
			) {
				throw new NativeFileValidationError(
					"Publish the attachment details before publishing its PDF.",
					{
						file: "The staged PDF no longer matches this attachment. Publish the attachment details, then upload the PDF again.",
					},
				);
			}

			if (!parent || parent.deleted === 1) {
				throw new NativeFileValidationError(
					"Publish the parent record first.",
					{
						file: "A PDF cannot be published until its parent record is published.",
					},
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
			await transaction
				.select({ itemKey: itemDraft.itemKey })
				.from(itemDraft)
				.where(inArray(itemDraft.itemKey, [attachment.key, parent.key]))
				.orderBy(itemDraft.itemKey)
				.for("update");
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
			await transaction
				.insert(tag)
				.values(normalizedPublicationTags.map((name) => ({ name })))
				.onConflictDoNothing();
			await transaction
				.insert(itemToTag)
				.values(
					normalizedPublicationTags.map((tagName) => ({
						itemKey,
						tagName,
					})),
				)
				.onConflictDoNothing();
			await advanceOpenNativeDraftBaseRevision(
				transaction,
				attachment.key,
				attachment.revision,
				nextRevision,
			);
			await advanceOpenNativeDraftBaseRevision(
				transaction,
				parent.key,
				parent.revision,
				parentNextRevision,
			);

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
				publicationTags: normalizedPublicationTags,
				publishedAt: now,
				updatedAt: now,
			};
			const [savedPublication] = await transaction
				.insert(itemFilePublication)
				.values(publicationValues)
				.onConflictDoUpdate({
					target: itemFilePublication.itemKey,
					set: publicationValues,
				})
				.returning();
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
			await ensureDefaultWritebackLink(transaction, itemKey);
			await markItemWritebackDirty(transaction, {
				canonicalRevision: nextRevision,
				dirtyFields: ["tags", "url"],
				itemKey,
				updatedAt: now,
			});
			await transaction
				.delete(itemFileDraft)
				.where(eq(itemFileDraft.itemKey, itemKey));

			return {
				file: savedPublication!,
				indexingRecords: [
					{ key: itemKey, revision: nextRevision },
					{ key: parent.key, revision: parentNextRevision },
				],
				item: publishedItem!,
				previousPrivatePaths: previousPublication
					? [
							previousPublication.sourceObjectPath,
							previousPublication.sourceCoverObjectPath,
						]
					: [],
				previousPublicPaths: previousPublication
					? [
							previousPublication.objectPath,
							previousPublication.coverObjectPath,
						]
					: [],
			};
		});
	let transactionResult: Awaited<ReturnType<typeof commitPublication>>;
	try {
		transactionResult = await commitPublication();
	} catch (error) {
		try {
			const [currentPublication, currentDraft] = await Promise.all([
				db
					.select({
						coverObjectPath: itemFilePublication.coverObjectPath,
						objectPath: itemFilePublication.objectPath,
						sourceCoverObjectPath:
							itemFilePublication.sourceCoverObjectPath,
						sourceObjectPath: itemFilePublication.sourceObjectPath,
					})
					.from(itemFilePublication)
					.where(eq(itemFilePublication.itemKey, itemKey))
					.limit(1)
					.then((rows) => rows[0]),
				db
					.select({
						coverObjectPath: itemFileDraft.coverObjectPath,
						objectPath: itemFileDraft.objectPath,
					})
					.from(itemFileDraft)
					.where(eq(itemFileDraft.itemKey, itemKey))
					.limit(1)
					.then((rows) => rows[0]),
			]);
			const referencedPublicPaths = new Set(
				currentPublication
					? [
							currentPublication.objectPath,
							currentPublication.coverObjectPath,
						]
					: [],
			);
			const referencedPrivatePaths = new Set([
				...(currentPublication
					? [
							currentPublication.sourceObjectPath,
							currentPublication.sourceCoverObjectPath,
						]
					: []),
				...(currentDraft
					? [currentDraft.objectPath, currentDraft.coverObjectPath]
					: []),
			]);
			const orphanedPublicPaths = [
				publicPaths.pdf,
				publicPaths.cover,
			].filter((objectPath) => !referencedPublicPaths.has(objectPath));
			const orphanedPrivatePaths = [
				draft.objectPath,
				draft.coverObjectPath,
			].filter((objectPath) => !referencedPrivatePaths.has(objectPath));
			const cleanupTasks: Promise<void>[] = [];
			if (orphanedPublicPaths.length > 0) {
				cleanupTasks.push(storage.removePublic(orphanedPublicPaths));
			}
			if (orphanedPrivatePaths.length > 0) {
				cleanupTasks.push(storage.removePrivate(orphanedPrivatePaths));
			}
			const cleanupResults = await Promise.allSettled(cleanupTasks);
			for (const cleanup of cleanupResults) {
				if (cleanup.status === "rejected") {
					console.error(
						"Failed to remove file objects after publication rollback",
						cleanup.reason,
					);
				}
			}
		} catch (cleanupError) {
			console.error(
				"Failed to resolve file objects after publication rollback",
				cleanupError,
			);
		}
		throw error;
	}

	const stalePrivatePaths = transactionResult.previousPrivatePaths.filter(
		(path) =>
			path !== transactionResult.file.sourceObjectPath &&
			path !== transactionResult.file.sourceCoverObjectPath,
	);
	if (stalePrivatePaths.length > 0) {
		try {
			await storage.removePrivate(stalePrivatePaths);
		} catch (error) {
			console.error(
				"Failed to remove replaced private file objects",
				error,
			);
		}
	}

	const stalePublicPaths = transactionResult.previousPublicPaths.filter(
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
		indexingRecords: transactionResult.indexingRecords,
		item: transactionResult.item,
	};
}

export async function unpublishNativePdfWithContext(
	db: Database,
	storage: EvidenceFileStorage,
	itemKey: string,
) {
	const result = await db.transaction(async (transaction) => {
		const [initialPublication] = await transaction
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
			.limit(1);
		if (!initialPublication) throw new NativeFileNotFoundError(itemKey);
		await lockItemMutations(transaction, [
			itemKey,
			initialPublication.parentItemKey,
		]);

		const lockedItems = await transaction
			.select()
			.from(item)
			.where(
				and(
					inArray(item.key, [
						itemKey,
						initialPublication.parentItemKey,
					]),
					eq(item.sourceConnectionKey, NATIVE_CONNECTION_KEY),
				),
			)
			.orderBy(item.key)
			.for("update");
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
		if (publication.parentItemKey !== initialPublication.parentItemKey) {
			throw new NativeFileConflictError(itemKey);
		}
		const attachment = lockedItems.find(
			(candidate) => candidate.key === itemKey,
		);
		const parent = lockedItems.find(
			(candidate) => candidate.key === publication.parentItemKey,
		);
		if (!attachment || !parent) {
			throw new NativeFileValidationError(
				"The published PDF could not be changed.",
				{
					file: "Reload the page and try again. If the problem continues, upload the PDF again.",
				},
			);
		}
		await transaction
			.select({ itemKey: itemDraft.itemKey })
			.from(itemDraft)
			.where(inArray(itemDraft.itemKey, [attachment.key, parent.key]))
			.orderBy(itemDraft.itemKey)
			.for("update");

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
			.delete(itemToTag)
			.where(
				and(
					eq(itemToTag.itemKey, itemKey),
					inArray(itemToTag.tagName, publication.publicationTags),
				),
			);
		await advanceOpenNativeDraftBaseRevision(
			transaction,
			attachment.key,
			attachment.revision,
			attachmentRevision,
		);
		await advanceOpenNativeDraftBaseRevision(
			transaction,
			parent.key,
			parent.revision,
			parentRevision,
		);
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
		await ensureDefaultWritebackLink(transaction, itemKey);
		await markItemWritebackDirty(transaction, {
			canonicalRevision: attachmentRevision,
			dirtyFields: ["tags", "url"],
			itemKey,
			updatedAt: now,
		});

		return {
			indexingRecords: [
				{ key: itemKey, revision: attachmentRevision },
				{ key: parent.key, revision: parentRevision },
			],
			item: updatedItem!,
			privatePaths: [
				publication.sourceObjectPath,
				publication.sourceCoverObjectPath,
			],
			publicPaths: [publication.objectPath, publication.coverObjectPath],
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
	return { indexingRecords: result.indexingRecords, item: result.item };
}

export async function unpublishNativePdf(
	db: Database,
	storage: EvidenceFileStorage,
	itemKey: string,
) {
	return (await unpublishNativePdfWithContext(db, storage, itemKey)).item;
}
