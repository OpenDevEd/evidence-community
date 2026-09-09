import { libraryConfigSchema } from "../src/config/library-config/schema";
import { maximalLibraryConfig } from "../tests/fixtures/library-config";
import { getAdminItemListPage } from "../src/lib/admin/item-list-query";
import { parseAdminItemListRequest } from "../src/lib/admin/item-list-contract";
import { getAdminReviewSnapshot } from "../src/lib/admin/review-query";
import { AdminValidationError } from "../src/lib/admin/errors";
import { itemReview, itemPublishingChoice } from "../src/db/schema/review";
import { correctItemReview, resolveReviewConflicts, approveItemReview, setItemPublishingChoice, submitItemReview, resolveItemReview } from "../src/lib/admin/review-service";
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
import { buildPublicationFileManifestHash } from "@opendeved/doi-sync-core";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { itemFilePublication } from "../src/db/schema/source";
import {
	publicationIdentifier,
	publicationSyncJob,
	publicationSyncState,
	publicationTarget,
	zenodoFileCorrectionApproval,
} from "../src/db/schema/publication";
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
	stageNativePdfRemoval,
	undoNativePdfRemoval,
	unpublishNativePdf,
	ZenodoPdfCorrectionConfirmationRequiredError,
} from "../src/lib/admin/native-file-service";
import { buildPublicationFileManifest } from "../src/lib/publication/record-adapter";
import {
	createNativeItemDraft,
	getItemDraft as getNativeItemDraft,
	ItemHasPublishedFileError as NativeItemHasPublishedFileError,
	openItemDraft as openNativeItemDraft,
	publishItemDraft as publishNativeItemDraft,
	publishItemDraftWithContext as publishNativeItemDraftWithContext,
	removeNativeItem,
	saveItemDraft as saveNativeItemDraft,
	unpublishNativeItem,
} from "../src/lib/admin/native-item-service";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;
const reviewConfig = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] });
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

	async downloadPublic(path: string) {
		const bytes = this.publicFiles.get(path);
		if (!bytes) throw new Error(`Missing public object ${path}`);
		return bytes.slice();
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

async function verifyCrossrefBackedPdfCorrectionApproval(
	db: ReturnType<typeof createPostgresDatabaseResource>["database"],
	storage: MemoryFileStorage,
	createdKeys: string[],
) {
	const parentDraft = await createNativeItemDraft(db, {
		itemType: "Report",
		title: "Crossref-backed PDF correction parent",
	});
	const attachmentDraft = await createNativeItemDraft(db, {
		itemType: "Attachment",
		parentItem: parentDraft.itemKey,
		title: "Crossref-backed PDF correction attachment",
	});
	createdKeys.push(parentDraft.itemKey, attachmentDraft.itemKey);
	const initialBytes = await createPdf("Crossref-backed original PDF");
	const initialStage = await stageNativePdfUpload(db, storage, {
		itemKey: attachmentDraft.itemKey,
		filename: "crossref-original.pdf",
		expectedSizeBytes: initialBytes.byteLength,
		expectedSha256: fileHash(initialBytes),
		maxPdfBytes: 10_000_000,
	});
	storage.privateFiles.set(initialStage.upload.path, initialBytes);
	const initialReady = await completeNativePdfUpload(db, storage, {
		itemKey: attachmentDraft.itemKey,
		expectedUploadRevision: initialStage.fileDraft.uploadRevision,
		maxPdfBytes: 10_000_000,
	});
	await publishNativeItemDraft(db, parentDraft.itemKey);
	await publishNativeItemDraft(db, attachmentDraft.itemKey);
	const initialPublication = await publishNativePdf(db, storage, {
		itemKey: attachmentDraft.itemKey,
		expectedUploadRevision: initialReady.uploadRevision,
		publicationTags: PUBLICATION_TAGS,
	});
	const firstPublishedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const baselineManifest = buildPublicationFileManifest([
		initialPublication.file,
	]);
	const managedDoi = "10.5555/library.file-correction";
	await db.insert(publicationTarget).values([
		{
			itemKey: parentDraft.itemKey,
			provider: "crossref",
			environment: "test",
			requestedBy: "native-file-test",
		},
		{
			itemKey: parentDraft.itemKey,
			provider: "zenodo",
			environment: "sandbox",
			identifierPolicy: "reuse-crossref",
			requestedBy: "native-file-test",
		},
	]);
	await db.insert(publicationIdentifier).values({
		itemKey: parentDraft.itemKey,
		registrar: "crossref",
		environment: "test",
		role: "primary",
		doi: managedDoi,
		ownership: "managed",
		lifecycle: "verified",
		isCurrent: true,
		reservedAt: firstPublishedAt,
		verifiedAt: firstPublishedAt,
	});
	await db.insert(publicationSyncState).values({
		itemKey: parentDraft.itemKey,
		provider: "zenodo",
		environment: "sandbox",
		identifierPolicy: "reuse-crossref",
		lastPayloadHash: "c".repeat(64),
		lastPayloadSnapshot: {},
		lastFileManifestHash:
			buildPublicationFileManifestHash(baselineManifest),
		lastFileManifestSnapshot: baselineManifest as unknown as Record<
			string,
			unknown
		>,
		zenodoRecordId: "7001",
		zenodoParentId: "7000",
		zenodoFirstPublishedAt: firstPublishedAt,
	});

	const correctionBytes = await createPdf("Crossref-backed corrected PDF");
	const correctionStage = await stageNativePdfUpload(db, storage, {
		itemKey: attachmentDraft.itemKey,
		filename: "crossref-correction.pdf",
		expectedSizeBytes: correctionBytes.byteLength,
		expectedSha256: fileHash(correctionBytes),
		maxPdfBytes: 10_000_000,
	});
	storage.privateFiles.set(correctionStage.upload.path, correctionBytes);
	const correctionReady = await completeNativePdfUpload(db, storage, {
		itemKey: attachmentDraft.itemKey,
		expectedUploadRevision: correctionStage.fileDraft.uploadRevision,
		maxPdfBytes: 10_000_000,
	});
	const publicFileCount = storage.publicFiles.size;
	let confirmationRequired = false;
	try {
		await publishNativePdf(db, storage, {
			itemKey: attachmentDraft.itemKey,
			expectedUploadRevision: correctionReady.uploadRevision,
			publicationTags: PUBLICATION_TAGS,
		});
	} catch (error) {
		confirmationRequired =
			error instanceof ZenodoPdfCorrectionConfirmationRequiredError;
	}
	const approvalsBeforeConfirmation = await db
		.select({ id: zenodoFileCorrectionApproval.id })
		.from(zenodoFileCorrectionApproval)
		.where(eq(zenodoFileCorrectionApproval.itemKey, parentDraft.itemKey));
	assert(
		confirmationRequired &&
			approvalsBeforeConfirmation.length === 0 &&
			storage.publicFiles.size === publicFileCount,
		"Crossref-backed PDF replacement did not stop before confirmation",
	);

	const correctedPublication = await publishNativePdf(db, storage, {
		itemKey: attachmentDraft.itemKey,
		expectedUploadRevision: correctionReady.uploadRevision,
		publicationTags: PUBLICATION_TAGS,
		zenodoFileChange: "minor_correction",
	});
	const [approval] = await db
		.select()
		.from(zenodoFileCorrectionApproval)
		.where(eq(zenodoFileCorrectionApproval.itemKey, parentDraft.itemKey));
	const correctedManifestHash = buildPublicationFileManifestHash(
		buildPublicationFileManifest([correctedPublication.file]),
	);
	const zenodoJobs = await db
		.select()
		.from(publicationSyncJob)
		.where(
			and(
				eq(publicationSyncJob.itemKey, parentDraft.itemKey),
				eq(publicationSyncJob.provider, "zenodo"),
				isNull(publicationSyncJob.supersededAt),
			),
		);
	assert(
		approval?.doi === managedDoi &&
			approval.fileManifestHash === correctedManifestHash &&
			approval.consumedAt === null &&
			approval.supersededAt === null &&
			correctedPublication.file.sha256 === fileHash(correctionBytes) &&
			zenodoJobs.some((job) => job.reason === "file_changed"),
		"Confirmed PDF correction did not save the exact approval with its worker job",
	);
	const publicFilesBeforeUnpublish = storage.publicFiles.size;
	let unpublishConfirmationRequired = false;
	try {
		await unpublishNativePdf(db, storage, attachmentDraft.itemKey);
	} catch (error) {
		unpublishConfirmationRequired =
			error instanceof ZenodoPdfCorrectionConfirmationRequiredError;
	}
	const [publicationBeforeUnpublishConfirmation] = await db
		.select({ itemKey: itemFilePublication.itemKey })
		.from(itemFilePublication)
		.where(eq(itemFilePublication.itemKey, attachmentDraft.itemKey))
		.limit(1);
	assert(
		unpublishConfirmationRequired &&
			publicationBeforeUnpublishConfirmation?.itemKey ===
				attachmentDraft.itemKey &&
			storage.publicFiles.size === publicFilesBeforeUnpublish,
		"Crossref-backed PDF removal did not stop before confirmation",
	);
	await unpublishNativePdf(
		db,
		storage,
		attachmentDraft.itemKey,
		"minor_correction",
	);
	const [removalApproval] = await db
		.select()
		.from(zenodoFileCorrectionApproval)
		.where(
			and(
				eq(zenodoFileCorrectionApproval.itemKey, parentDraft.itemKey),
				isNull(zenodoFileCorrectionApproval.consumedAt),
				isNull(zenodoFileCorrectionApproval.supersededAt),
			),
		)
		.limit(1);
	assert(
		removalApproval?.fileManifestHash ===
			buildPublicationFileManifestHash(
				buildPublicationFileManifest([]),
			) && storage.publicFiles.size === 0,
		"Confirmed PDF removal did not save the exact approval before cleanup",
	);
}

async function verifyNonZenodoDuplicateFilenames(
	db: ReturnType<typeof createPostgresDatabaseResource>["database"],
	storage: MemoryFileStorage,
	createdKeys: string[],
) {
	const parent = await createNativeItemDraft(db, {
		itemType: "Report",
		title: "Non-Zenodo duplicate filename parent",
	});
	const attachments = await Promise.all([
		createNativeItemDraft(db, {
			itemType: "Attachment",
			parentItem: parent.itemKey,
			title: "Duplicate filename attachment one",
		}),
		createNativeItemDraft(db, {
			itemType: "Attachment",
			parentItem: parent.itemKey,
			title: "Duplicate filename attachment two",
		}),
	]);
	createdKeys.push(parent.itemKey, ...attachments.map(({ itemKey }) => itemKey));
	await publishNativeItemDraft(db, parent.itemKey);
	for (const [index, attachment] of attachments.entries()) {
		const bytes = await createPdf(`Duplicate filename PDF ${index + 1}`);
		const staged = await stageNativePdfUpload(db, storage, {
			itemKey: attachment.itemKey,
			filename: "shared.pdf",
			expectedSizeBytes: bytes.byteLength,
			expectedSha256: fileHash(bytes),
			maxPdfBytes: 10_000_000,
		});
		storage.privateFiles.set(staged.upload.path, bytes);
		const ready = await completeNativePdfUpload(db, storage, {
			itemKey: attachment.itemKey,
			expectedUploadRevision: staged.fileDraft.uploadRevision,
			maxPdfBytes: 10_000_000,
		});
		await publishNativeItemDraft(db, attachment.itemKey);
		await publishNativePdf(db, storage, {
			itemKey: attachment.itemKey,
			expectedUploadRevision: ready.uploadRevision,
			publicationTags: PUBLICATION_TAGS,
		});
	}
	const publications = await db
		.select({ itemKey: itemFilePublication.itemKey })
		.from(itemFilePublication)
		.where(eq(itemFilePublication.parentItemKey, parent.itemKey));
	assert(
		publications.length === 2,
		"Non-Zenodo PDF publishing ran Zenodo filename validation",
	);
	for (const attachment of attachments) {
		await unpublishNativePdf(db, storage, attachment.itemKey);
	}
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = resource.database;
	const storage = new MemoryFileStorage();
	const createdKeys: string[] = [];
	const connectionKey = `native-file-writeback-${process.pid}-${Date.now()}`;

	try {
		await db.insert(sourceConnection).values({
			externalScopeKey: connectionKey,
			key: connectionKey,
			provider: "zotero",
			scopeKind: "group",
		});

		const reviewStorage = new MemoryFileStorage();
		const citationTarget = await createNativeItemDraft(db, {itemType: "Report", title: "Referenced publication"});
        createdKeys.push(citationTarget.itemKey);
        await publishNativeItemDraft(db, citationTarget.itemKey);
        const noFileDraft = await createNativeItemDraft(db, { itemType: "Report", title: "Publish without a file", links: {cites: [citationTarget.itemKey], related: []} });
		createdKeys.push(noFileDraft.itemKey);
		const noFileActor = { userId: "no-file-creator", role: "creator" } as const;
		let choiceRequired = false;
		try { await submitItemReview(db, noFileDraft.itemKey, noFileActor); }
		catch (error) { choiceRequired = error instanceof AdminValidationError; }
		assert(choiceRequired, "Created item submission accepted a missing identifier choice");
		await setItemPublishingChoice(db, noFileDraft.itemKey, { route: "crossref-zenodo", identifierPolicy: "reuse-crossref" });
		const noFileReview = await submitItemReview(db, noFileDraft.itemKey, noFileActor);
        await setItemPublishingChoice(db, noFileDraft.itemKey, { route: "zenodo", identifierPolicy: "mint-zenodo" });
		let creatorDenied = false;
		try { await approveItemReview(db, reviewStorage, { reviewId: noFileReview.id, expectedRevision: noFileReview.revision, publicationTags: PUBLICATION_TAGS }, noFileActor, reviewConfig); }
		catch (error) { creatorDenied = error instanceof AdminValidationError; }
		assert(creatorDenied, "Creator could approve a review");
		const laterDraft = await saveNativeItemDraft(db, {itemKey: noFileDraft.itemKey, expectedDraftRevision: noFileDraft.draftRevision, expectedPayload: noFileDraft.payload, payload: {...noFileDraft.payload, title: "Creator's later title"}});
		const corrected = await correctItemReview(db, {reviewId: noFileReview.id, expectedRevision: noFileReview.revision, records: noFileReview.snapshot.records.map(record => ({...record, payload: {...record.payload, title: "Editor's corrected title"}}))}, {userId: "no-file-editor", role: "editor"});
		const noFileApproval = await approveItemReview(db, reviewStorage, { reviewId: noFileReview.id, expectedRevision: corrected.revision, publicationTags: PUBLICATION_TAGS }, { userId: "no-file-editor", role: "editor" }, reviewConfig);
		assert(noFileApproval.review.state === "published", "A PDF was required to publish a review");
        const [approvedPublic] = await db.select({ revision: item.revision }).from(item).where(eq(item.key, noFileDraft.itemKey));
        assert(noFileApproval.indexingRecords.some(record => record.key === noFileDraft.itemKey && record.revision === approvedPublic?.revision), "Approval omitted the final public revision from indexing receipts");
        assert(noFileApproval.indexingRecords.some(record => record.key === citationTarget.itemKey), "Approval omitted the changed citation target from indexing receipts");

        assert(noFileApproval.review.remainingConflicts[noFileDraft.itemKey]?.includes("title"), "Correction failed to preserve the conflicting working title");
        const conflictDraft = await getNativeItemDraft(db, noFileDraft.itemKey);
        assert(conflictDraft, "Conflicting draft disappeared");
        const resolution = {reviewId: noFileReview.id, expectedRevision: noFileApproval.review.revision, itemKey: noFileDraft.itemKey, generation: conflictDraft.generation, draftRevision: conflictDraft.draftRevision, choices: {title: "published" as const}};
        let staleResolutionDenied = false;
        try { await resolveReviewConflicts(db, {...resolution, draftRevision: laterDraft.draftRevision - 1}, reviewConfig); }
        catch { staleResolutionDenied = true; }
        assert(staleResolutionDenied, "Conflict resolution accepted a stale draft revision");
        const resolved = await resolveReviewConflicts(db, resolution, reviewConfig);
        const resolvedDraft = await getNativeItemDraft(db, noFileDraft.itemKey);
        assert(!resolved.remainingConflicts[noFileDraft.itemKey] && resolvedDraft?.payload.title === "Editor's corrected title", "Resolution did not atomically apply the published choice");

        const activatedTargets = await db.select().from(publicationTarget).where(eq(publicationTarget.itemKey, noFileDraft.itemKey));
        assert(activatedTargets.length === 2 && activatedTargets.every(target => target.activatedAt !== null), "Approval used the later draft route instead of its submitted Crossref and Zenodo choice");
        const activationJobs = await db.select().from(publicationSyncJob).where(eq(publicationSyncJob.itemKey, noFileDraft.itemKey));
        assert(activationJobs.length === 2 && activationJobs.every(job => job.processedAt === null), "Approval failed to queue both providers without files");

        const imported = await createNativeItemDraft(db, { itemType: "Report", title: "Imported restoration" });
        createdKeys.push(imported.itemKey);
        await db.update(itemIdentity).set({ kind: "imported" }).where(eq(itemIdentity.key, imported.itemKey));
        const importedSubmission = await submitItemReview(db, imported.itemKey, noFileActor);
        const reviewer = { userId: "restoration-editor", role: "editor" } as const;
        await approveItemReview(db, reviewStorage, { reviewId: importedSubmission.id, expectedRevision: importedSubmission.revision, publicationTags: PUBLICATION_TAGS }, reviewer, reviewConfig);
        await unpublishNativeItem(db, imported.itemKey);
        await openNativeItemDraft(db, imported.itemKey);
        const restoration = await submitItemReview(db, imported.itemKey, noFileActor);
        const [beforeRestore] = await db.select().from(item).where(eq(item.key, imported.itemKey));
        assert(beforeRestore?.deleted === 1, "Submitting restoration made the item public without approval");
        await approveItemReview(db, reviewStorage, { reviewId: restoration.id, expectedRevision: restoration.revision, publicationTags: PUBLICATION_TAGS }, reviewer, reviewConfig);
        const [afterRestore] = await db.select().from(item).where(eq(item.key, imported.itemKey));
        assert(afterRestore?.deleted === 0, "Approved restoration did not return the item to the public library");
		const reviewParent = await createNativeItemDraft(db, { itemType: "Report", title: "Review file parent" });
		createdKeys.push(reviewParent.itemKey);
		const reviewAttachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: reviewParent.itemKey, title: "Submitted PDF" });
		createdKeys.push(reviewAttachment.itemKey);
		const reviewPdf = await createPdf("Submitted file stays private and available");
		const reviewStage = await stageNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, filename: "submitted.pdf", expectedSizeBytes: reviewPdf.byteLength, expectedSha256: fileHash(reviewPdf), maxPdfBytes: 10_000_000 });
		reviewStorage.privateFiles.set(reviewStage.upload.path, reviewPdf);
		await completeNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, expectedUploadRevision: reviewStage.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		await setItemPublishingChoice(db, reviewParent.itemKey, { route: "zenodo", identifierPolicy: "mint-zenodo" });
		const actor = { userId: "review-test-creator", role: "creator" } as const;
		const captured = await submitItemReview(db, reviewParent.itemKey, actor);
		const queued = await getAdminItemListPage(db, parseAdminItemListRequest({ reviewQueue: true }));
		assert(queued.items.some((entry) => entry.key === reviewParent.itemKey), "Submitted root is missing from review queue");
		assert(!queued.items.some((entry) => entry.key === reviewAttachment.itemKey || entry.key === noFileReview.itemKey), "Review queue includes an attachment or resolved review");
		assert(captured.snapshot.records.length === 2, "Submission omitted an unpublished attachment");
		const replacementPdf = await createPdf("A later working file");
		const reviewReplacement = await stageNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, filename: "replacement.pdf", expectedSizeBytes: replacementPdf.byteLength, expectedSha256: fileHash(replacementPdf), maxPdfBytes: 10_000_000 });
		assert(reviewStorage.privateFiles.has(reviewStage.upload.path), "Replacing a draft deleted the submitted PDF");
		reviewStorage.privateFiles.set(reviewReplacement.upload.path, replacementPdf);
		await completeNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, expectedUploadRevision: reviewReplacement.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		const approvedReview = await approveItemReview(db, reviewStorage, { reviewId: captured.id, expectedRevision: captured.revision, publicationTags: PUBLICATION_TAGS }, { userId: "review-test-editor", role: "editor" }, reviewConfig);
		assert(approvedReview.review.state === "published", "Review approval did not finish");
		const displayedSnapshot = await getAdminReviewSnapshot(db, captured.id);
        const [publishedReviewRoot] = await db.select().from(item).where(eq(item.key, reviewParent.itemKey));
        assert(publishedReviewRoot && displayedSnapshot.revision === publishedReviewRoot.revision && displayedSnapshot.revision > 0, "Submitted inspector lost the published revision");
		const displayedFile = displayedSnapshot.frozenAttachments.find((attachment) => attachment.key === reviewAttachment.itemKey);
		assert(displayedFile?.fileDraft?.actualSha256 === fileHash(reviewPdf), "Submitted-version data showed the newer PDF");
		assert(displayedFile.sourceFileUrl?.includes(captured.id), "Submitted PDF link was not bound to its review");
		const [approvedFile] = await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, reviewAttachment.itemKey));
		assert(approvedFile?.sourceObjectPath === reviewStage.upload.path, "Approval published the later working PDF");
		const [remainingUpload] = await db.select().from(itemFileDraft).where(eq(itemFileDraft.itemKey, reviewAttachment.itemKey));
		assert(remainingUpload?.objectPath === reviewReplacement.upload.path, "Approval discarded the later working PDF");
		await discardNativePdfDraft(db, reviewStorage, reviewAttachment.itemKey);
		assert(reviewStorage.privateFiles.has(reviewStage.upload.path), "Discarding a later draft deleted the submitted PDF");
		assert(!reviewStorage.privateFiles.has(reviewReplacement.upload.path), "Discarding an unreferenced working PDF leaked its object");
		const nextReview = await submitItemReview(db, reviewParent.itemKey, actor);
		const withdrawn = await resolveItemReview(db, { reviewId: nextReview.id, expectedRevision: nextReview.revision, action: "withdrawn" }, actor);
		assert(withdrawn.state === "withdrawn", "Creator could not withdraw their review");
		await stageNativePdfRemoval(db, reviewStorage, reviewAttachment.itemKey);
		const [stillPublic] = await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, reviewAttachment.itemKey));
		assert(stillPublic?.sha256 === fileHash(reviewPdf), "Staging removal changed the public file before approval");
		assert(reviewStorage.publicFiles.has(stillPublic.objectPath), "Staging removal deleted the public PDF");
		await undoNativePdfRemoval(db, reviewAttachment.itemKey);
		await stageNativePdfRemoval(db, reviewStorage, reviewAttachment.itemKey);
		const removalReview = await submitItemReview(db, reviewParent.itemKey, actor);
		const laterUpload = await stageNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, filename: "after-removal.pdf", expectedSizeBytes: replacementPdf.byteLength, expectedSha256: fileHash(replacementPdf), maxPdfBytes: 10_000_000 });
		reviewStorage.privateFiles.set(laterUpload.upload.path, replacementPdf);
		await completeNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, expectedUploadRevision: laterUpload.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		await approveItemReview(db, reviewStorage, { reviewId: removalReview.id, expectedRevision: removalReview.revision, publicationTags: PUBLICATION_TAGS }, { userId: "review-test-editor", role: "editor" }, reviewConfig);
		const [removedFile] = await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, reviewAttachment.itemKey));
		const [preservedUpload] = await db.select().from(itemFileDraft).where(eq(itemFileDraft.itemKey, reviewAttachment.itemKey));
		assert(!removedFile, "Approved removal left the old PDF published");
		assert(preservedUpload?.objectPath === laterUpload.upload.path && reviewStorage.privateFiles.has(laterUpload.upload.path), "Approving a removal discarded a later working upload");
		assert(reviewStorage.privateFiles.has(reviewStage.upload.path), "Approving removal deleted an earlier submitted PDF");


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

		// The parent chooses the writeback source; the attachment copies it.
		await publishNativeItemDraftWithContext(db, parentDraft.itemKey, {
			sourceKeys: [connectionKey],
			writebackConfig: {
				sources: [{ key: connectionKey, writebackEnabled: true }],
			},
		});
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
		await db.insert(publicationTarget).values([
			{
				itemKey: parentDraft.itemKey,
				provider: "crossref",
				environment: "test",
				requestedBy: "native-file-test",
			},
			{
				itemKey: parentDraft.itemKey,
				provider: "zenodo",
				environment: "sandbox",
				identifierPolicy: "mint-zenodo",
				requestedBy: "native-file-test",
			},
		]);

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
		assert(
			published.file.publicationTags.join(",") ===
				PUBLICATION_TAGS.join(","),
			"File publication did not retain ownership of its publication tags",
		);
		const publicationJobsAfterFilePublish = await db
			.select()
			.from(publicationSyncJob)
			.where(
				and(
					eq(publicationSyncJob.itemKey, parentDraft.itemKey),
					isNull(publicationSyncJob.supersededAt),
				),
			);
		const parentFilePublishRevision = published.indexingRecords.find(
			(record) => record.key === parentDraft.itemKey,
		)?.revision;
		assert(
			parentFilePublishRevision != null &&
				publicationJobsAfterFilePublish.length === 2 &&
				publicationJobsAfterFilePublish.every(
					(job) =>
						job.reason === "file_changed" &&
						job.canonicalRevision === parentFilePublishRevision,
				) &&
				publicationJobsAfterFilePublish.some(
					(job) =>
						job.provider === "zenodo" &&
						job.fileRevision === published.file.revision,
				),
			"File publication did not queue both active publication targets",
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
				tags: ["topic-tag"],
				title: "Renamed PDF metadata",
			},
		});
		const republishedMetadata = await publishNativeItemDraft(
			db,
			attachmentDraft.itemKey,
		);
		const tagsAfterMetadataPublish = await db
			.select({ name: itemToTag.tagName })
			.from(itemToTag)
			.where(eq(itemToTag.itemKey, attachmentDraft.itemKey));
		assert(
			republishedMetadata.revision === 3 &&
				republishedMetadata.url === published.item.url &&
				republishedMetadata.PDFCoverPageImage ===
					published.item.PDFCoverPageImage &&
				republishedMetadata.fullTextPDF ===
					published.item.fullTextPDF &&
				tagsAfterMetadataPublish.some(
					({ name }) => name === PUBLICATION_TAGS[0],
				) &&
				tagsAfterMetadataPublish.some(
					({ name }) => name === "topic-tag",
				),
			"Metadata publication erased file-managed state or publication tags",
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
		const [parentAfterFileUnpublish] = await db
			.select({ revision: item.revision })
			.from(item)
			.where(eq(item.key, parentDraft.itemKey));
		const activePublicationJobsAfterFileUnpublish = await db
			.select()
			.from(publicationSyncJob)
			.where(
				and(
					eq(publicationSyncJob.itemKey, parentDraft.itemKey),
					isNull(publicationSyncJob.supersededAt),
				),
			);
        assert(
            activePublicationJobsAfterFileUnpublish.length === 2 &&
            activePublicationJobsAfterFileUnpublish.every(job => job.reason === "file_changed" && job.canonicalRevision === parentAfterFileUnpublish?.revision) &&
            activePublicationJobsAfterFileUnpublish.some(job => job.provider === "zenodo" && job.fileRevision === null),
            "File removal did not queue the updated archive state",
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
			unpublishNativePdf(db, storage, concurrentAttachmentDraft.itemKey),
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
		await verifyNonZenodoDuplicateFilenames(
			db,
			storage,
			createdKeys,
		);
		await verifyCrossrefBackedPdfCorrectionApproval(
			db,
			storage,
			createdKeys,
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
			await db.delete(itemReview).where(inArray(itemReview.itemKey, createdKeys));
			await db.delete(itemPublishingChoice).where(inArray(itemPublishingChoice.itemKey, createdKeys));
			await db
				.delete(publicationSyncJob)
				.where(inArray(publicationSyncJob.itemKey, createdKeys));
			await db
				.delete(zenodoFileCorrectionApproval)
				.where(
					inArray(zenodoFileCorrectionApproval.itemKey, createdKeys),
				);
			await db
				.delete(publicationIdentifier)
				.where(inArray(publicationIdentifier.itemKey, createdKeys));
			await db
				.delete(publicationSyncState)
				.where(inArray(publicationSyncState.itemKey, createdKeys));
			await db
				.delete(publicationTarget)
				.where(inArray(publicationTarget.itemKey, createdKeys));
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
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
