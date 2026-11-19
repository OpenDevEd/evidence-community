import type { LibraryServerConfig } from "@/config/library-config/schema";
import { hiddenPath } from "./withdrawn-path";
import { isNotNull } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
	itemDraft,
	itemFileDraft,
	outbox,
} from "@opendeved/evidence-library-core";
import {
	buildPublicationFileManifestHash,
	zenodoFileCorrectionStartDeadline,
} from "@opendeved/doi-sync-core";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { lockItemMutations } from "@/db/canonical-mutation-lock";
import {
	publicationIdentifier,
	publicationSyncState,
	publicationTarget,
	type ZenodoIdentifierPolicy,
	zenodoFileCorrectionApproval,
} from "@/db/schema/publication";
import { itemFileRemoval } from "@/db/schema/review";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { tag } from "@/db/schema/tables/tag";
import {
	applyParentWritebackLinks,
	markItemWritebackDirty,
} from "@/lib/source-writeback/queue";
import { enqueuePublicationJobsForItem } from "@/lib/publication/queue";
import { buildPublicationFileManifest } from "@/lib/publication/record-adapter";

import { reviewFileSchema, type ReviewFile } from "./review-contract";
import { removeUnreferencedPrivateFiles } from "./file-retention";
import type { EvidenceFileStorage } from "./file-storage";
import { advanceOpenItemDraftBaseRevision as advanceOpenNativeDraftBaseRevision, isNativeOrOpenAlex } from "./native-item-service";
import { coverContentType, processPdf } from "./pdf-processing";
import { writePdfProperties } from "./pdf-properties";
import type { PdfProperties } from "./pdf-record-mapping";
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

function formatUtcDateTime(value: Date) {
	return `${value.toLocaleString("en", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	})} UTC`;
}

export class ZenodoPdfCorrectionConfirmationRequiredError extends Error {
	constructor(readonly approveBy: Date) {
		super(
			`This record reuses its DOI in Zenodo. Changing its published PDFs will update the same Zenodo record and DOI. Confirm that this is a minor correction. Approval closes at ${formatUtcDateTime(approveBy)}.`,
		);
		this.name = "ZenodoPdfCorrectionConfirmationRequiredError";
	}
}

type PublicationConfig = LibraryServerConfig["services"]["publication"];

type PdfCorrectionRequirement = {
	environment: PublicationConfig["zenodo"]["environment"];
	doi: string;
	fileManifestHash: string;
	approveBy: Date;
};

type PdfCorrectionIdentifier = {
	environment: "test" | "sandbox" | "production";
	ownership: "managed" | "external";
	registrar: "crossref" | "zenodo";
	role: "primary" | "version";
};

export function zenodoPdfCorrectionIdentifier(
	identifierPolicy: ZenodoIdentifierPolicy | null,
	config: PublicationConfig,
): PdfCorrectionIdentifier | null {
	if (identifierPolicy === "reuse-crossref") {
		return {
			environment: config.crossref.environment,
			ownership: "managed",
			registrar: "crossref",
			role: "primary",
		};
	}
	if (identifierPolicy === "reuse-external") {
		return {
			environment: config.zenodo.environment,
			ownership: "external",
			registrar: "zenodo",
			role: "version",
		};
	}
	return null;
}

function publicationFileManifestHash(
	files: readonly (typeof itemFilePublication.$inferSelect)[],
) {
	try {
		return buildPublicationFileManifestHash(
			buildPublicationFileManifest(files),
		);
	} catch (error) {
		throw new NativeFileValidationError(
			"The published PDFs cannot be prepared for Zenodo.",
			{
				file:
					error instanceof Error
						? error.message
						: "Check the staged PDF and try again.",
			},
		);
	}
}

async function zenodoPdfCorrectionRequirement(
	database: Database | DatabaseTransaction,
	config: PublicationConfig,
	input: {
		fileManifestHash: () => string;
		now: Date;
		parentItemKey: string;
	},
): Promise<PdfCorrectionRequirement | null> {
	const [target] = await database
		.select({ identifierPolicy: publicationTarget.identifierPolicy })
		.from(publicationTarget)
		.where(
			and(
				eq(publicationTarget.itemKey, input.parentItemKey),
				eq(publicationTarget.provider, "zenodo"),
				eq(publicationTarget.environment, config.zenodo.environment),
				isNull(publicationTarget.deactivatedAt),
                    isNotNull(publicationTarget.activatedAt),
			),
		)
		.limit(1);
	const identifierLookup = zenodoPdfCorrectionIdentifier(
		target?.identifierPolicy ?? null,
		config,
	);
	if (!identifierLookup) return null;

	const [state] = await database
		.select({
			firstPublishedAt: publicationSyncState.zenodoFirstPublishedAt,
			lastFileManifestHash: publicationSyncState.lastFileManifestHash,
			recordId: publicationSyncState.zenodoRecordId,
		})
		.from(publicationSyncState)
		.where(
			and(
				eq(publicationSyncState.itemKey, input.parentItemKey),
				eq(publicationSyncState.provider, "zenodo"),
				eq(publicationSyncState.environment, config.zenodo.environment),
			),
		)
		.limit(1);
	if (!state?.recordId) return null;
	if (!state.lastFileManifestHash || !state.firstPublishedAt) {
		throw new NativeFileValidationError(
			"Zenodo's saved PDF state is incomplete.",
			{
				file: "Retry the Zenodo sync before replacing this PDF.",
			},
		);
	}
	const fileManifestHash = input.fileManifestHash();
	if (state.lastFileManifestHash === fileManifestHash) return null;

	const approveBy = zenodoFileCorrectionStartDeadline(
		state.firstPublishedAt,
	);
	if (input.now > approveBy) {
		throw new NativeFileValidationError(
			"The Zenodo PDF correction window has closed.",
			{
				file: `This PDF change cannot be approved after ${formatUtcDateTime(approveBy)}.`,
			},
		);
	}

	const [identifier] = await database
		.select({ doi: publicationIdentifier.doi })
		.from(publicationIdentifier)
		.where(
			and(
				eq(publicationIdentifier.itemKey, input.parentItemKey),
				eq(publicationIdentifier.registrar, identifierLookup.registrar),
				eq(
					publicationIdentifier.environment,
					identifierLookup.environment,
				),
				eq(publicationIdentifier.role, identifierLookup.role),
				eq(publicationIdentifier.ownership, identifierLookup.ownership),
				eq(publicationIdentifier.lifecycle, "verified"),
				eq(publicationIdentifier.isCurrent, true),
			),
		)
		.limit(1);
	if (!identifier) {
		throw new NativeFileValidationError(
			"The DOI needed for this Zenodo correction is unavailable.",
			{ file: "Retry the publication sync before replacing this PDF." },
		);
	}
	return {
		environment: config.zenodo.environment,
		doi: identifier.doi,
		fileManifestHash,
		approveBy,
	};
}

async function saveZenodoPdfCorrectionApproval(
	transaction: DatabaseTransaction,
	input: PdfCorrectionRequirement & { itemKey: string; now: Date },
) {
	await transaction
		.update(zenodoFileCorrectionApproval)
		.set({ supersededAt: input.now, updatedAt: input.now })
		.where(
			and(
				eq(zenodoFileCorrectionApproval.itemKey, input.itemKey),
				eq(zenodoFileCorrectionApproval.environment, input.environment),
				isNull(zenodoFileCorrectionApproval.consumedAt),
				isNull(zenodoFileCorrectionApproval.supersededAt),
			),
		);
	await transaction.insert(zenodoFileCorrectionApproval).values({
		environment: input.environment,
		itemKey: input.itemKey,
		doi: input.doi,
		fileManifestHash: input.fileManifestHash,
		approvedAt: input.now,
		createdAt: input.now,
		updatedAt: input.now,
	});
}

type StageNativePdfInput = {
	expectedSha256: string;
	expectedSizeBytes: number;
	filename: string;
	itemKey: string;
	maxPdfBytes: number;
};

/** Gives the attachment this publication's tags, and takes off those an earlier publication of it added. */
async function replacePublicationTags(transaction: DatabaseTransaction, itemKey: string, previous: readonly string[], next: readonly string[]) {
	const superseded = previous.filter((name) => !next.includes(name));
	if (superseded.length > 0)
		await transaction.delete(itemToTag).where(and(eq(itemToTag.itemKey, itemKey), inArray(itemToTag.tagName, superseded)));
	if (next.length === 0) return;
	await transaction.insert(tag).values(next.map((name) => ({ name }))).onConflictDoNothing();
	await transaction.insert(itemToTag).values(next.map((tagName) => ({ itemKey, tagName }))).onConflictDoNothing();
}

/** None when no Zotero group the record writes back to needs a tag to publish the PDF. */
function normalizePublicationTags(values: readonly string[]) {
	const tags = [...new Set(values.map((value) => value.trim()))].filter(
		Boolean,
	);
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
	return pdfPath.replace(/\/file\.pdf$/u, "/cover.jpg");
}

function publishedPaths(itemKey: string, sha256: string, stagedCover: string) {
	const base = `native/${itemKey}/published/${randomUUID()}-${sha256}`;
	return {
		cover: `${base}/cover${path.extname(stagedCover)}`,
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
		await lockItemMutations(transaction, [input.itemKey]);
		await transaction.delete(itemFileRemoval).where(eq(itemFileRemoval.itemKey, input.itemKey));
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
			await removeUnreferencedPrivateFiles(db, storage, staged.stalePrivatePaths);
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

async function loadNativeFileDraft(db: Database, itemKey: string, expectedUploadRevision: number) {
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
	return draft;
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
	const draft = await loadNativeFileDraft(db, itemKey, expectedUploadRevision);
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
	await storage.uploadPrivate(coverObjectPath, processed.cover, coverContentType(coverObjectPath));

	const [ready] = await db.transaction(async (transaction) => {
		await lockItemMutations(transaction, [itemKey]);
		return transaction
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
	});
	if (!ready) {
		try {
			await removeUnreferencedPrivateFiles(db, storage, [coverObjectPath]);
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

/** Mark removal in the working draft; public and submitted objects stay intact. */
export async function stageNativePdfRemoval(db: Database, storage: EvidenceFileStorage, itemKey: string) {
	const paths = await db.transaction(async (transaction) => {
		await lockItemMutations(transaction, [itemKey]);
		const [publication] = await transaction.select().from(itemFilePublication)
			.where(and(eq(itemFilePublication.itemKey, itemKey), eq(itemFilePublication.sourceConnectionKey, NATIVE_CONNECTION_KEY)));
		if (!publication) throw new NativeFileNotFoundError(itemKey);
		const [draft] = await transaction.delete(itemFileDraft).where(eq(itemFileDraft.itemKey, itemKey)).returning();
		await transaction.insert(itemFileRemoval).values({ itemKey }).onConflictDoNothing();
		return draft ? [draft.objectPath, draft.coverObjectPath].filter((value): value is string => Boolean(value)) : [];
	});
	await removeUnreferencedPrivateFiles(db, storage, paths);
}

export async function undoNativePdfRemoval(db: Database, itemKey: string) {
	await db.transaction(async (transaction) => {
		await lockItemMutations(transaction, [itemKey]);
		await transaction.delete(itemFileRemoval).where(eq(itemFileRemoval.itemKey, itemKey));
	});
}

export async function discardNativePdfDraft(
	db: Database,
	storage: EvidenceFileStorage,
	itemKey: string,
) {
	const privatePaths = await db.transaction(async (transaction) => {
		await lockItemMutations(transaction, [itemKey]);
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
		await removeUnreferencedPrivateFiles(db, storage, privatePaths);
	} catch (error) {
		console.error("Failed to remove discarded staged file objects", error);
	}
}

async function loadPublicationFile(
	db: Database,
	itemKey: string,
	expectedUploadRevision: number,
	reviewFile?: ReviewFile,
) {
	const workingFile = reviewFile ? undefined : await loadNativeFileDraft(db, itemKey, expectedUploadRevision);
	const draft = reviewFile ? {
		...reviewFile,
		actualSha256: reviewFile.sha256,
		actualSizeBytes: reviewFile.sizeBytes,
		readyAt: new Date(),
	} : workingFile;
	if (reviewFile && (reviewFile.itemKey !== itemKey || reviewFile.uploadRevision !== expectedUploadRevision)) throw new NativeFileConflictError(itemKey);
	if (!draft?.readyAt) throw new NativeFileConflictError(itemKey);
	const parsed = reviewFileSchema.safeParse({
		...draft,
		sha256: draft.actualSha256,
		sizeBytes: draft.actualSizeBytes,
	});
	if (!parsed.success) throw new NativeFileConflictError(itemKey);
	return {
		...parsed.data,
		actualSha256: parsed.data.sha256,
		actualSizeBytes: parsed.data.sizeBytes,
		readyAt: draft.readyAt,
	};
}

function assertLockedFileDraft(
 itemKey: string,
 lockedDraft: Awaited<ReturnType<typeof loadPublicationFile>> | typeof itemFileDraft.$inferSelect | undefined,
 draft: Awaited<ReturnType<typeof loadPublicationFile>>,
): asserts lockedDraft is NonNullable<typeof lockedDraft> {
	if (
		!lockedDraft?.readyAt ||
		lockedDraft.uploadRevision !== draft.uploadRevision ||
		lockedDraft.actualSha256 !== draft.actualSha256
	) {
		throw new NativeFileConflictError(itemKey);
	}
	if (lockedDraft.parentItemKey !== draft.parentItemKey) {
		throw new NativeFileConflictError(itemKey);
	}
}

async function lockFilePublicationRecords(
	transaction: DatabaseTransaction,
	itemKey: string,
	draft: Awaited<ReturnType<typeof loadPublicationFile>>,
	reviewFile: ReviewFile | undefined,
) {
	await lockItemMutations(transaction, [
		itemKey,
		draft.parentItemKey,
	]);
	const [currentFileDraft] = await transaction
		.select()
		.from(itemFileDraft)
		.where(eq(itemFileDraft.itemKey, itemKey))
		.for("update")
		.limit(1);
	const lockedDraft = reviewFile ? draft : currentFileDraft;
	assertLockedFileDraft(itemKey, lockedDraft, draft);

	const lockedItems = await transaction
		.select()
		.from(item)
		.where(
			and(
				inArray(item.key, [itemKey, lockedDraft.parentItemKey]),
				isNativeOrOpenAlex(transaction, item.sourceConnectionKey),
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
	return { lockedDraft, attachment, parent };
}

/** The PDF with the record written into its own metadata; one that can't take it is published as it is. */
async function withRecordProperties(bytes: Uint8Array, properties: PdfProperties | undefined) {
	if (!properties) return bytes;
	try {
		return await writePdfProperties(bytes, properties);
	} catch (error) {
		console.error("Writing the record into the published PDF failed, so it is published unchanged", error);
		return bytes;
	}
}

export async function prepareNativePdfPublication(
	db: Database,
	storage: EvidenceFileStorage,
	config: PublicationConfig,
	{
		expectedUploadRevision,
		itemKey,
		properties,
		publicationTags,
		zenodoFileChange,
		reviewFile,
		hidden = false,
	}: {
		expectedUploadRevision: number;
		itemKey: string;
		/**
		 * Its record keeps its files from readers (`filesHiddenFor`): the copy goes to the private place a hidden file
		 * keeps (`hiddenPath`), never the public bucket, and `placeRecordFiles` brings it out once readers may have it.
		 */
		hidden?: boolean;
		/** The record as it is published, written into the published copy's metadata. */
		properties?: PdfProperties;
		publicationTags: readonly string[];
		zenodoFileChange?: "minor_correction";
		reviewFile?: ReviewFile;
	},
) {
	const normalizedPublicationTags = normalizePublicationTags(publicationTags);
	const draft = await loadPublicationFile(db, itemKey, expectedUploadRevision, reviewFile);
	const [attachmentBeforePublish, previousPublication, currentFiles] =
		await Promise.all([
			db
				.select({ revision: item.revision })
				.from(item)
				.where(eq(item.key, itemKey))
				.limit(1)
				.then((rows) => rows[0]),
			db
				.select()
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, itemKey))
				.limit(1)
				.then((rows) => rows[0]),
			db
				.select()
				.from(itemFilePublication)
				.where(
					eq(
						itemFilePublication.parentItemKey,
						draft.parentItemKey,
					),
				),
		]);
	const [stagedBytes, coverBytes] = await Promise.all([
		storage.downloadPrivate(draft.objectPath),
		storage.downloadPrivate(draft.coverObjectPath),
	]);
	if (
		stagedBytes.byteLength !== draft.actualSizeBytes ||
		sha256(stagedBytes) !== draft.actualSha256
	) {
		throw new NativeFileValidationError(
			"The staged PDF could not be published.",
			{
				file: "Upload the PDF again, then retry publishing.",
			},
		);
	}
	// The published copy carries the record in its own metadata. Its hashes are
	// recorded, so the library and Zenodo share this one file.
	const pdfBytes = await withRecordProperties(stagedBytes, properties);
	const publishedSha256 = sha256(pdfBytes);

	if (attachmentBeforePublish) {
		const prospectiveFile = {
			...(previousPublication ?? {}),
			itemKey,
			contentType: PDF_CONTENT_TYPE,
			filename: draft.filename,
			md5: previousPublication?.md5 ?? "",
			revision: attachmentBeforePublish.revision + 1,
			sha256: publishedSha256,
			sizeBytes: pdfBytes.byteLength,
		};
		const prospectiveFiles = previousPublication
			? currentFiles.map((file) =>
					file.itemKey === itemKey ? prospectiveFile : file,
				)
			: [...currentFiles, prospectiveFile];
		const requirement = await zenodoPdfCorrectionRequirement(db, config, {
			fileManifestHash: () =>
				publicationFileManifestHash(prospectiveFiles),
			now: new Date(),
			parentItemKey: draft.parentItemKey,
		});
		if (requirement && zenodoFileChange !== "minor_correction") {
			throw new ZenodoPdfCorrectionConfirmationRequiredError(
				requirement.approveBy,
			);
		}
	}

	const publicPaths = publishedPaths(itemKey, publishedSha256, draft.coverObjectPath);
	const put = (path: string, bytes: Uint8Array, type: string) => (hidden ? storage.uploadPrivate(hiddenPath(path), bytes, type) : storage.uploadPublic(path, bytes, type));
	const uploads = await Promise.allSettled([
		put(publicPaths.pdf, pdfBytes, PDF_CONTENT_TYPE),
		put(publicPaths.cover, coverBytes, coverContentType(draft.coverObjectPath)),
	]);
	const failedUpload = uploads.find((result) => result.status === "rejected");
	if (failedUpload?.status === "rejected") {
		try { await (hidden ? storage.removePrivate([hiddenPath(publicPaths.pdf), hiddenPath(publicPaths.cover)]) : storage.removePublic([publicPaths.pdf, publicPaths.cover])); }
		catch (error) { console.error("Failed to clean prepared public files", error); }
		throw failedUpload.reason;
	}
	const publicUrl = storage.publicUrl(publicPaths.pdf);
	const coverPublicUrl = storage.publicUrl(publicPaths.cover);
	const md5 = createHash("md5").update(pdfBytes).digest("hex");

	const commitPublication = async (transaction: DatabaseTransaction) => {
			const { lockedDraft, attachment, parent } = await lockFilePublicationRecords(
				transaction, itemKey, draft, reviewFile,
			);
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
			await replacePublicationTags(transaction, itemKey, previousPublication?.publicationTags ?? [], normalizedPublicationTags);
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
				sizeBytes: pdfBytes.byteLength,
				sha256: publishedSha256,
				md5,
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
			const parentFiles = await transaction
				.select()
				.from(itemFilePublication)
				.where(
					eq(itemFilePublication.parentItemKey, parent.key),
				);
			const correctionRequirement =
				await zenodoPdfCorrectionRequirement(transaction, config, {
					fileManifestHash: () =>
						publicationFileManifestHash(parentFiles),
					now,
					parentItemKey: parent.key,
				});
			if (
				correctionRequirement &&
				zenodoFileChange !== "minor_correction"
			) {
				throw new ZenodoPdfCorrectionConfirmationRequiredError(
					correctionRequirement.approveBy,
				);
			}
			if (correctionRequirement) {
				await saveZenodoPdfCorrectionApproval(transaction, {
					itemKey: parent.key,
					...correctionRequirement,
					now,
				});
			}
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
			await applyParentWritebackLinks(transaction, {
				itemKey,
				parentItemKey: parent.key,
			});
			await markItemWritebackDirty(transaction, {
				canonicalRevision: nextRevision,
				dirtyFields: ["tags", "url"],
				itemKey,
				updatedAt: now,
			});
			await enqueuePublicationJobsForItem(transaction, {
				itemKey: parent.key,
				canonicalRevision: parentNextRevision,
				reason: "file_changed",
				now,
			});
			await transaction
				.delete(itemFileDraft)
				.where(and(eq(itemFileDraft.itemKey, itemKey), eq(itemFileDraft.objectPath, draft.objectPath)));

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
		};
	const rollback = async () => {
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
			].filter((objectPath): objectPath is string => Boolean(objectPath) && !referencedPrivatePaths.has(objectPath));
			const cleanupTasks: Promise<void>[] = [];
			if (orphanedPublicPaths.length > 0) {
				cleanupTasks.push(storage.removePublic(orphanedPublicPaths));
			}
			if (orphanedPrivatePaths.length > 0) {
				cleanupTasks.push(removeUnreferencedPrivateFiles(db, storage, orphanedPrivatePaths));
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
	};
	const cleanup = async (transactionResult: Awaited<ReturnType<typeof commitPublication>>) => {
	const stalePrivatePaths = transactionResult.previousPrivatePaths.filter(
		(path) =>
			path !== transactionResult.file.sourceObjectPath &&
			path !== transactionResult.file.sourceCoverObjectPath,
	);
	if (stalePrivatePaths.length > 0) {
		try {
			await removeUnreferencedPrivateFiles(db, storage, stalePrivatePaths);
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
	};
	return { commit: commitPublication, rollback, cleanup };
}

export async function publishNativePdf(
	db: Database,
	storage: EvidenceFileStorage,
	config: PublicationConfig,
	input: Omit<Parameters<typeof prepareNativePdfPublication>[3], "reviewFile">,
) {
	const prepared = await prepareNativePdfPublication(db, storage, config, input);
	let result: Awaited<ReturnType<typeof prepared.commit>>;
	try {
		result = await db.transaction(prepared.commit);
	} catch (error) {
		await prepared.rollback();
		throw error;
	}
	return prepared.cleanup(result);
}

export async function unpublishNativePdfInTransaction(
	transaction: DatabaseTransaction,
	config: PublicationConfig,
	itemKey: string,
	zenodoFileChange?: "minor_correction",
) {
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
					isNativeOrOpenAlex(transaction, item.sourceConnectionKey),
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
		if (publication.publicationTags.length > 0)
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
		const remainingFiles = await transaction
			.select()
			.from(itemFilePublication)
			.where(eq(itemFilePublication.parentItemKey, parent.key));
		const correctionRequirement =
			await zenodoPdfCorrectionRequirement(transaction, config, {
				fileManifestHash: () =>
					publicationFileManifestHash(remainingFiles),
				now,
				parentItemKey: parent.key,
			});
		if (
			correctionRequirement &&
			zenodoFileChange !== "minor_correction"
		) {
			throw new ZenodoPdfCorrectionConfirmationRequiredError(
				correctionRequirement.approveBy,
			);
		}
		if (correctionRequirement) {
			await saveZenodoPdfCorrectionApproval(transaction, {
				itemKey: parent.key,
				...correctionRequirement,
				now,
			});
		}
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
		await applyParentWritebackLinks(transaction, {
			itemKey,
			parentItemKey: parent.key,
		});
		await markItemWritebackDirty(transaction, {
			canonicalRevision: attachmentRevision,
			dirtyFields: ["tags", "url"],
			itemKey,
			updatedAt: now,
		});
		await enqueuePublicationJobsForItem(transaction, {
			itemKey: parent.key,
			canonicalRevision: parentRevision,
			reason: "file_changed",
			now,
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
}

export async function cleanupNativePdfRemoval(
	db: Database,
	storage: EvidenceFileStorage,
	result: Awaited<ReturnType<typeof unpublishNativePdfInTransaction>>,
) {
	const cleanupResults = await Promise.allSettled([
		storage.removePublic(result.publicPaths),
		removeUnreferencedPrivateFiles(db, storage, result.privatePaths),
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

async function unpublishNativePdfWithContext(
	db: Database,
	storage: EvidenceFileStorage,
	config: PublicationConfig,
	itemKey: string,
	zenodoFileChange?: "minor_correction",
) {
	const result = await db.transaction((transaction) => unpublishNativePdfInTransaction(transaction, config, itemKey, zenodoFileChange));
	return cleanupNativePdfRemoval(db, storage, result);
}

export async function unpublishNativePdf(
	db: Database,
	storage: EvidenceFileStorage,
	config: PublicationConfig,
	itemKey: string,
	zenodoFileChange?: "minor_correction",
) {
	return (
		await unpublishNativePdfWithContext(
			db,
			storage,
			config,
			itemKey,
			zenodoFileChange,
		)
	).item;
}
