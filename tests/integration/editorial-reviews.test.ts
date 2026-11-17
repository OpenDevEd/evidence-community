import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { itemIdentity, itemFileDraft } from "@opendeved/evidence-library-core";
import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { MemoryFileStorage, createPdf, fileHash } from "../helpers/file-storage";
import { getAdminItemListPage } from "../../src/lib/admin/item-list-query";
import { parseAdminItemListRequest } from "../../src/lib/admin/item-list-contract";
import { getAdminPdfObject } from "../../src/lib/admin/file-cover-query";
import { getAdminReviewSnapshot } from "../../src/lib/admin/review-query";
import { AdminValidationError } from "../../src/lib/admin/errors";
import { itemReview, itemPublishingChoice } from "../../src/db/schema/review";
import { item } from "../../src/db/schema/tables/item";
import { itemFilePublication, sourceConnection } from "../../src/db/schema/source";
import { itemFieldOverride, itemSourceValue } from "../../src/db/schema/topics";
import { publicationTarget, publicationSyncJob, publicationSyncState } from "../../src/db/schema/publication";
import { ZenodoIdentifierPolicyLockedError } from "../../src/lib/publication/errors";
import { getItemPublishingChoice, correctItemReview, resolveReviewConflicts, approveItemReview, setItemPublishingChoice, submitItemReview, resolveItemReview } from "../../src/lib/admin/review-service";
import { createNativeItemDraft, publishItemDraft as publishNativeItemDraft, saveItemDraft as saveNativeItemDraft, getItemDraft as getNativeItemDraft, openItemDraft as openNativeItemDraft, discardItemDraft, removeNativeItem, unpublishNativeItem } from "../../src/lib/admin/native-item-service";
import { stageNativePdfUpload, completeNativePdfUpload, discardNativePdfDraft, stageNativePdfRemoval, undoNativePdfRemoval } from "../../src/lib/admin/native-file-service";
import { readPdfProperties } from "../../src/lib/admin/pdf-properties";
import { reserveCrossrefDoi } from "../../src/lib/publication/crossref-activation-service";
const reviewConfig = libraryConfigSchema.parse({...maximalLibraryConfig, sources: []});
const noFileActor = {userId: "no-file-creator", role: "creator"} as const;
it("refuses a DOI choice in a community that hasn't set up Zenodo", async () => {
	const withoutDois = libraryConfigSchema.parse({...maximalLibraryConfig, sources: [], services: {...maximalLibraryConfig.services, publication: {}}});
	await withIsolatedPublicationDatabase(async db => {
		const draft = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "No DOI to register", date: "2026-10-08", publisher: "OpenDevEd", creators: [{creatorType: "author", firstName: "QA", lastName: "Author"}]});
		await assert.rejects(setItemPublishingChoice(db, draft.itemKey, {route: "zenodo", identifierPolicy: "mint-zenodo"}, withoutDois), AdminValidationError);
		assert.equal((await getItemPublishingChoice(db, draft.itemKey, withoutDois)).choice, null);
	});
});
it.each(["reuse-crossref", "mint-zenodo"] as const)("rejects incompatible %s choices before save and submission, while preserving valid routes", async (policy) => {
	await withIsolatedPublicationDatabase(async db => {
		const draft = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Locked identifier", date: "2026-10-08", publisher: "OpenDevEd", creators: [{creatorType: "author", firstName: "QA", lastName: "Author"}]});
		const compatible = {route: "crossref-zenodo", identifierPolicy: policy};
		const incompatible = policy === "reuse-crossref" ? {route: "zenodo", identifierPolicy: "mint-zenodo"} : {route: "crossref-zenodo", identifierPolicy: "reuse-crossref"};
		await db.insert(publicationTarget).values({itemKey: draft.itemKey, provider: "zenodo", environment: "sandbox", identifierPolicy: policy, requestedBy: "editor"});
		// Activation without a provider write must still permit a different choice.
		await setItemPublishingChoice(db, draft.itemKey, incompatible, reviewConfig);
		assert.equal((await getItemPublishingChoice(db, draft.itemKey, reviewConfig)).lockedIdentifierPolicy, null);
		await db.insert(publicationSyncState).values({itemKey: draft.itemKey, provider: "zenodo", environment: "sandbox", identifierPolicy: policy, unpublishedDraftDepositionId: "12345"});
		await assert.rejects(submitItemReview(db, draft.itemKey, noFileActor, reviewConfig), ZenodoIdentifierPolicyLockedError);
		assert.equal((await db.select().from(itemReview)).length, 0);
		await setItemPublishingChoice(db, draft.itemKey, compatible, reviewConfig);
		await assert.rejects(setItemPublishingChoice(db, draft.itemKey, incompatible, reviewConfig), ZenodoIdentifierPolicyLockedError);
		assert.deepEqual((await db.select().from(itemPublishingChoice))[0]?.choice, compatible);
		assert.equal((await getItemPublishingChoice(db, draft.itemKey, reviewConfig)).lockedIdentifierPolicy, policy);
		const productionConfig = structuredClone(reviewConfig);
		productionConfig.services.publication.zenodo.environment = "production";
		assert.equal((await getItemPublishingChoice(db, draft.itemKey, productionConfig)).lockedIdentifierPolicy, null);
		if (policy === "mint-zenodo") {
			await setItemPublishingChoice(db, draft.itemKey, {route: "zenodo", identifierPolicy: policy}, reviewConfig);
			await setItemPublishingChoice(db, draft.itemKey, compatible, reviewConfig);
		}
		const review = await submitItemReview(db, draft.itemKey, noFileActor, reviewConfig);
		assert.deepEqual(review.snapshot.publishingChoice, compatible);
	});
});
it("hides topic source conflicts from reviews while Topics are off", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const draft = await createNativeItemDraft(db, {
			itemType: "Report",
			licence: { kind: "zenodo", id: "cc-by-4.0" },
			title: "Review source fields",
		});
		await db.insert(sourceConnection).values({key: "oa", provider: "openalex", scopeKind: "query", config: {}});
		await db.insert(itemSourceValue).values({itemKey: draft.itemKey, sourceConnectionKey: "oa", payload: {title: "Source title", topics: []}, importedTopics: false});
		await db.insert(itemFieldOverride).values([
			{
				itemKey: draft.itemKey,
				field: "topics",
				value: ["T12260"],
				sourceValue: [],
				sourceConnectionKey: "oa",
			},
			{
				itemKey: draft.itemKey,
				field: "title",
				value: "Review source fields",
				sourceValue: "Source title",
				sourceConnectionKey: "oa",
			},
		]);
		const review = await submitItemReview(db, draft.itemKey, noFileActor, reviewConfig);
		const snapshot = await getAdminReviewSnapshot(db, review.id, {
			topicsEnabled: false,
		});

		assert.deepEqual(
			snapshot.sourceFields.map((field) => field.field),
			["title"],
		);
	});
}, 120_000);

it('allows no identifiers by default and after clearing a choice, and publishes the frozen None snapshot without provider work', async () => {
 await withIsolatedPublicationDatabase(async db => {
  const storage = new MemoryFileStorage();
  for (const route of [null, "zenodo", "crossref-zenodo"] as const) {
   const draft = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Publication without identifiers"});
   assert.deepEqual(await getItemPublishingChoice(db, draft.itemKey, reviewConfig), {choice: null, canClear: true, lockedIdentifierPolicy: null});
   if (route) {
    await setItemPublishingChoice(db, draft.itemKey, route === "zenodo" ? {route, identifierPolicy: "mint-zenodo"} : {route, identifierPolicy: "reuse-crossref"}, reviewConfig);
    await setItemPublishingChoice(db, draft.itemKey, null, reviewConfig);
    assert.equal((await getItemPublishingChoice(db, draft.itemKey, reviewConfig)).choice, null);
   }
   const review = await submitItemReview(db, draft.itemKey, noFileActor, reviewConfig);
   assert.equal(review.snapshot.publishingChoice, null);
   await setItemPublishingChoice(db, draft.itemKey, {route: "crossref-zenodo", identifierPolicy: "reuse-crossref"}, reviewConfig);
   const result = await approveItemReview(db, storage, {reviewId: review.id, expectedRevision: review.revision}, {userId: "editor", role: "editor"}, reviewConfig);
   assert.equal(result.review.state, "published");
   assert.equal((await db.select().from(item).where(eq(item.key, draft.itemKey))).length, 1);
   assert.deepEqual(await db.select().from(publicationTarget).where(eq(publicationTarget.itemKey, draft.itemKey)), []);
   assert.deepEqual(await db.select().from(publicationSyncJob).where(eq(publicationSyncJob.itemKey, draft.itemKey)), []);
  }
 });
}, 120_000);

it("says in the list where a record's submitted version stands: waiting for an editor, sent back, then neither once it is published", async () => {
 await withIsolatedPublicationDatabase(async db => {
  const editor = {userId: "editor", role: "editor"} as const;
  const standing = async (key: string) => (await getAdminItemListPage(db, parseAdminItemListRequest({}))).items.find(row => row.key === key)?.review;
  const draft = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Where a submitted version stands"});
  assert.equal(await standing(draft.itemKey), null);
  const first = await submitItemReview(db, draft.itemKey, noFileActor, reviewConfig);
  assert.equal(await standing(draft.itemKey), "pending");
  await resolveItemReview(db, {reviewId: first.id, expectedRevision: first.revision, action: "returned", note: "Add the year"}, editor);
  assert.equal(await standing(draft.itemKey), "returned");
  const second = await submitItemReview(db, draft.itemKey, noFileActor, reviewConfig);
  assert.equal(await standing(draft.itemKey), "pending");
  await approveItemReview(db, new MemoryFileStorage(), {reviewId: second.id, expectedRevision: second.revision}, editor, reviewConfig);
  assert.equal(await standing(draft.itemKey), null);
 });
}, 120_000);

it('publishes the frozen identifier choice without a PDF and resolves later draft conflicts', async () => {
 await withIsolatedPublicationDatabase(async db => {
 const reviewStorage = new MemoryFileStorage();
		const citationTarget = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Referenced publication"});

        await publishNativeItemDraft(db, citationTarget.itemKey);
        const noFileDraft = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Publish without a file", language: "en", date: "2026-09-10", institution: "Learning Lab", creators: [{creatorType: "author", name: "Learning Lab"}], links: {cites: [citationTarget.itemKey], related: []} });

		await setItemPublishingChoice(db, noFileDraft.itemKey, { route: "crossref-zenodo", identifierPolicy: "reuse-crossref" }, reviewConfig);
		const noFileReview = await submitItemReview(db, noFileDraft.itemKey, noFileActor, reviewConfig);
        await setItemPublishingChoice(db, noFileDraft.itemKey, { route: "zenodo", identifierPolicy: "mint-zenodo" }, reviewConfig);
		let creatorDenied = false;
		try { await approveItemReview(db, reviewStorage, { reviewId: noFileReview.id, expectedRevision: noFileReview.revision }, noFileActor, reviewConfig); }
		catch (error) { creatorDenied = error instanceof AdminValidationError; }
		assert(creatorDenied, "Creator could approve a review");
		const laterDraft = await saveNativeItemDraft(db, {itemKey: noFileDraft.itemKey, expectedDraftRevision: noFileDraft.draftRevision, expectedPayload: noFileDraft.payload, payload: {...noFileDraft.payload, title: "Creator's later title", languageName: "fr"}});
        const incomplete = await correctItemReview(db, {reviewId: noFileReview.id, expectedRevision: noFileReview.revision, records: noFileReview.snapshot.records.map(record => ({...record, payload: {...record.payload, publisher: "", date: ""}}))}, {userId: "no-file-editor", role: "editor"});
        await assert.rejects(
            approveItemReview(db, reviewStorage, {reviewId: incomplete.id, expectedRevision: incomplete.revision}, {userId: "no-file-editor", role: "editor"}, reviewConfig),
            (error: unknown) => error instanceof AdminValidationError && Boolean(error.fields.institution) && Boolean(error.fields.date),
            "Approval must validate editor corrections against the frozen Crossref choice",
        );
        assert.equal((await db.select().from(item).where(eq(item.key, noFileDraft.itemKey))).length, 0);
		const corrected = await correctItemReview(db, {reviewId: noFileReview.id, expectedRevision: incomplete.revision, records: noFileReview.snapshot.records.map(record => ({...record, payload: {...record.payload, title: "Editor's corrected title", languageName: "es"}}))}, {userId: "no-file-editor", role: "editor"});
		const noFileApproval = await approveItemReview(db, reviewStorage, { reviewId: noFileReview.id, expectedRevision: corrected.revision }, { userId: "no-file-editor", role: "editor" }, reviewConfig);
		assert(noFileApproval.review.state === "published", "A PDF was required to publish a review");
        const [approvedPublic] = await db.select({ revision: item.revision }).from(item).where(eq(item.key, noFileDraft.itemKey));
        assert(noFileApproval.indexingRecords.some(record => record.key === noFileDraft.itemKey && record.revision === approvedPublic?.revision), "Approval omitted the final public revision from indexing receipts");
        assert(noFileApproval.indexingRecords.some(record => record.key === citationTarget.itemKey), "Approval omitted the changed citation target from indexing receipts");

        assert(noFileApproval.review.remainingConflicts[noFileDraft.itemKey]?.includes("title"), "Correction failed to preserve the conflicting working title");
        const conflictDraft = await getNativeItemDraft(db, noFileDraft.itemKey);
        assert(conflictDraft, "Conflicting draft disappeared");
        const resolution = {reviewId: noFileReview.id, expectedRevision: noFileApproval.review.revision, itemKey: noFileDraft.itemKey, generation: conflictDraft.generation, draftRevision: conflictDraft.draftRevision, choices: {title: "draft" as const, languageName: "published" as const}};
        let staleResolutionDenied = false;
        try { await resolveReviewConflicts(db, {...resolution, draftRevision: laterDraft.draftRevision - 1}, reviewConfig); }
        catch { staleResolutionDenied = true; }
        assert(staleResolutionDenied, "Conflict resolution accepted a stale draft revision");
        const resolved = await resolveReviewConflicts(db, resolution, reviewConfig);
        const resolvedDraft = await getNativeItemDraft(db, noFileDraft.itemKey);
        assert(!resolved.remainingConflicts[noFileDraft.itemKey] && resolvedDraft?.payload.title === "Creator's later title" && resolvedDraft.payload.languageName === "es", "Resolution did not atomically apply the published choice");

        const activatedTargets = await db.select().from(publicationTarget).where(eq(publicationTarget.itemKey, noFileDraft.itemKey));
        assert(activatedTargets.length === 2 && activatedTargets.every(target => target.activatedAt !== null), "Approval used the later draft route instead of its submitted Crossref and Zenodo choice");
        assert.equal((await getItemPublishingChoice(db, noFileDraft.itemKey, reviewConfig)).canClear, false);
        await assert.rejects(setItemPublishingChoice(db, noFileDraft.itemKey, null, reviewConfig), AdminValidationError);
        const activationJobs = await db.select().from(publicationSyncJob).where(eq(publicationSyncJob.itemKey, noFileDraft.itemKey));
        assert(activationJobs.length === 2 && activationJobs.every(job => job.processedAt === null), "Approval failed to queue both providers without files");


 });
}, 120_000);

it('clears conflicts when their working draft is discarded or attachment removed', async () => {
 await withIsolatedPublicationDatabase(async db => {
 const reviewStorage = new MemoryFileStorage();
        for (const removeChild of [false, true]) {
            const root = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Conflict recovery"});

            await db.update(itemIdentity).set({kind: "imported"}).where(eq(itemIdentity.key, root.itemKey));
            await publishNativeItemDraft(db, root.itemKey);
            let target = root;
            if (removeChild) {
                target = await createNativeItemDraft(db, {itemType: "Note", note: "Initial note", parentItem: root.itemKey});

                await publishNativeItemDraft(db, target.itemKey);
            }
            const field = removeChild ? "note" : "title";
            const opened = await openNativeItemDraft(db, target.itemKey);
            const submission = await submitItemReview(db, root.itemKey, noFileActor, reviewConfig);
            await saveNativeItemDraft(db, {itemKey: target.itemKey, expectedDraftGeneration: opened.generation, expectedDraftRevision: opened.draftRevision, expectedPayload: opened.payload, payload: {...opened.payload, [field]: "Later working value"}});
            const correctedSubmission = await correctItemReview(db, {reviewId: submission.id, expectedRevision: submission.revision, records: submission.snapshot.records.filter(record => record.itemKey === target.itemKey).map(record => ({...record, payload: {...record.payload, [field]: "Approved correction"}}))}, {userId: "recovery-editor", role: "editor"});
            const approval = await approveItemReview(db, reviewStorage, {reviewId: submission.id, expectedRevision: correctedSubmission.revision}, {userId: "recovery-editor", role: "editor"}, reviewConfig);
            assert(approval.review.remainingConflicts[target.itemKey]?.includes(field), "Recovery fixture did not create a conflict");
            if (removeChild) await removeNativeItem(db, target.itemKey);
            else await discardItemDraft(db, target.itemKey);
            const [cleared] = await db.select().from(itemReview).where(eq(itemReview.id, submission.id));
            assert(!cleared?.remainingConflicts[target.itemKey], "Discarded edits left a conflict blocking resubmission");
            assert(cleared.revision === approval.review.revision + 1, "Conflict removal did not invalidate the old review revision");
            const resubmission = await submitItemReview(db, root.itemKey, noFileActor, reviewConfig);
            await resolveItemReview(db, {reviewId: resubmission.id, expectedRevision: resubmission.revision, action: "withdrawn"}, noFileActor);
        }


 });
}, 120_000);

it('submits the materialized draft after source updates without changing the public record', async () => {
 await withIsolatedPublicationDatabase(async db => {
  const created = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Original source title", abstractNote: "Original source abstract"});
  await db.update(itemIdentity).set({kind: "imported"}).where(eq(itemIdentity.key, created.itemKey));
  const published = await publishNativeItemDraft(db, created.itemKey);
  const opened = await openNativeItemDraft(db, created.itemKey);
  await saveNativeItemDraft(db, {itemKey: created.itemKey, expectedDraftGeneration: opened.generation, expectedDraftRevision: opened.draftRevision, expectedPayload: opened.payload, payload: {...opened.payload, title: "Working title"}});
  // A source import changes the public record while the private patch stays open.
  const [sourceUpdate] = await db.update(item).set({title: "Updated source title", abstractNote: "Updated source abstract", revision: published.revision + 1}).where(eq(item.key, created.itemKey)).returning();
  const displayed = await getNativeItemDraft(db, created.itemKey);
  assert(displayed);
  assert.equal(displayed.payload.title, "Working title");
  assert.equal(displayed.payload.abstractNote, "Updated source abstract");
  const submitted = await submitItemReview(db, created.itemKey, noFileActor, reviewConfig);
  const record = submitted.snapshot.records.find(record => record.itemKey === created.itemKey);
  assert.equal(record?.baseRevision, sourceUpdate!.revision);
  assert.deepEqual(record?.payload, displayed.payload);
  assert.equal((await db.select().from(item).where(eq(item.key, created.itemKey)))[0]?.title, "Updated source title");
  await approveItemReview(db, new MemoryFileStorage(), {reviewId: submitted.id, expectedRevision: submitted.revision}, {userId: "source-update-editor", role: "editor"}, reviewConfig);
  const [approved] = await db.select().from(item).where(eq(item.key, created.itemKey));
  assert.equal(approved?.title, "Working title");
  assert.equal(approved?.abstractNote, "Updated source abstract");
 });
}, 120_000);

it('rejects approval when public data changes after submission', async () => {
 await withIsolatedPublicationDatabase(async db => {
 const reviewStorage = new MemoryFileStorage();
        const staleRoot = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Stale review recovery"});

        await db.update(itemIdentity).set({kind: "imported"}).where(eq(itemIdentity.key, staleRoot.itemKey));
        await publishNativeItemDraft(db, staleRoot.itemKey);
        // A submitted change: a record the review only shows is never published again, so it can't go stale.
        await openNativeItemDraft(db, staleRoot.itemKey);
        const staleSubmission = await submitItemReview(db, staleRoot.itemKey, noFileActor, reviewConfig);
        const citing = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "New citation", links: {cites: [staleRoot.itemKey], related: []}});

        await publishNativeItemDraft(db, citing.itemKey);
        let staleReviewRejected = false;
        try { await approveItemReview(db, reviewStorage, {reviewId: staleSubmission.id, expectedRevision: staleSubmission.revision}, {userId: "recovery-editor", role: "editor"}, reviewConfig); }
        catch (error) { staleReviewRejected = error instanceof AdminValidationError; }
        assert(staleReviewRejected, "Stale approval did not return the review recovery error");
        const [stillPending] = await db.select().from(itemReview).where(eq(itemReview.id, staleSubmission.id));
        assert(stillPending?.state === "pending", "Rejected stale approval changed the submitted version");
        await resolveItemReview(db, {reviewId: staleSubmission.id, expectedRevision: staleSubmission.revision, action: "withdrawn"}, noFileActor);


 });
}, 120_000);

it('keeps an imported restoration private until approved', async () => {
 await withIsolatedPublicationDatabase(async db => {
 const reviewStorage = new MemoryFileStorage();
        const imported = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Imported restoration" });

        await db.update(itemIdentity).set({ kind: "imported" }).where(eq(itemIdentity.key, imported.itemKey));
        const importedSubmission = await submitItemReview(db, imported.itemKey, noFileActor, reviewConfig);
        const reviewer = { userId: "restoration-editor", role: "editor" } as const;
        await approveItemReview(db, reviewStorage, { reviewId: importedSubmission.id, expectedRevision: importedSubmission.revision }, reviewer, reviewConfig);
        await unpublishNativeItem(db, imported.itemKey);
        await openNativeItemDraft(db, imported.itemKey);
        const restoration = await submitItemReview(db, imported.itemKey, noFileActor, reviewConfig);
        const [beforeRestore] = await db.select().from(item).where(eq(item.key, imported.itemKey));
        assert(beforeRestore?.deleted === 1, "Submitting restoration made the item public without approval");
        await approveItemReview(db, reviewStorage, { reviewId: restoration.id, expectedRevision: restoration.revision }, reviewer, reviewConfig);
        const [afterRestore] = await db.select().from(item).where(eq(item.key, imported.itemKey));
        assert(afterRestore?.deleted === 0, "Approved restoration did not return the item to the public library");

 });
}, 120_000);

it('preserves submitted PDF bytes across replacements and staged removal', async () => {
 await withIsolatedPublicationDatabase(async db => {
 const reviewStorage = new MemoryFileStorage();
		const reviewParent = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Review file parent", date: "2026-09-10", creators: [{creatorType: "author", name: "Learning Lab"}] });

		const reviewAttachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: reviewParent.itemKey, title: "Submitted PDF" });

		const reviewPdf = await createPdf("Submitted file stays private and available");
		const reviewStage = await stageNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, filename: "submitted.pdf", expectedSizeBytes: reviewPdf.byteLength, expectedSha256: fileHash(reviewPdf), maxPdfBytes: 10_000_000 });
		reviewStorage.privateFiles.set(reviewStage.upload.path, reviewPdf);
		await completeNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, expectedUploadRevision: reviewStage.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		await setItemPublishingChoice(db, reviewParent.itemKey, { route: "zenodo", identifierPolicy: "mint-zenodo" }, reviewConfig);
		const actor = { userId: "review-test-creator", role: "creator" } as const;
		const captured = await submitItemReview(db, reviewParent.itemKey, actor, reviewConfig);
        const getAdminPdfCover = async (...[database, storage, key, revision, reviewId]: [typeof db, typeof reviewStorage, string, number, string?]) => (await getAdminPdfObject(database, storage, key, revision, "cover", reviewId)).bytes;
        const originalCover = await getAdminPdfCover(db, reviewStorage, reviewAttachment.itemKey, reviewStage.fileDraft.uploadRevision);
        const submittedPdf = await getAdminPdfObject(db, reviewStorage, reviewAttachment.itemKey, reviewStage.fileDraft.uploadRevision, "file", captured.id);
        assert.equal(submittedPdf.filename, reviewStage.fileDraft.filename);
        assert.deepEqual(submittedPdf.bytes, reviewStorage.privateFiles.get(reviewStage.upload.path), "The submitted PDF is not the frozen upload");
        const submittedCover = await getAdminPdfCover(db, reviewStorage, reviewAttachment.itemKey, reviewStage.fileDraft.uploadRevision, captured.id);
        assert.deepEqual(submittedCover, originalCover);
        await assert.rejects(getAdminPdfCover(db, reviewStorage, reviewAttachment.itemKey, reviewStage.fileDraft.uploadRevision + 1, captured.id), /not found/i);
        const resolvedRoot = await createNativeItemDraft(db, {itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Already reviewed"});
        await db.update(itemIdentity).set({kind: "imported"}).where(eq(itemIdentity.key, resolvedRoot.itemKey));
        const resolvedSubmission = await submitItemReview(db, resolvedRoot.itemKey, actor, reviewConfig);
        await approveItemReview(db, reviewStorage, {reviewId: resolvedSubmission.id, expectedRevision: resolvedSubmission.revision}, {userId: "editor", role: "editor"}, reviewConfig);
		const queued = await getAdminItemListPage(db, parseAdminItemListRequest({ reviewQueue: true }));
		assert(queued.items.some((entry) => entry.key === reviewParent.itemKey), "Submitted root is missing from review queue");
		assert(!queued.items.some((entry) => entry.key === reviewAttachment.itemKey || entry.key === resolvedRoot.itemKey), "Review queue includes an attachment or resolved review");
		assert(captured.snapshot.records.length === 2, "Submission omitted an unpublished attachment");
		const replacementPdf = await createPdf("A later working file");
		const reviewReplacement = await stageNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, filename: "replacement.pdf", expectedSizeBytes: replacementPdf.byteLength, expectedSha256: fileHash(replacementPdf), maxPdfBytes: 10_000_000 });
		assert(reviewStorage.privateFiles.has(reviewStage.upload.path), "Replacing a draft deleted the submitted PDF");
		reviewStorage.privateFiles.set(reviewReplacement.upload.path, replacementPdf);
		await completeNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, expectedUploadRevision: reviewReplacement.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		const frozenCover = await getAdminPdfCover(db, reviewStorage, reviewAttachment.itemKey, reviewStage.fileDraft.uploadRevision, captured.id);
        assert.deepEqual(frozenCover, originalCover, "Replacing the working PDF changed the submitted cover");
        const replacementCover = await getAdminPdfCover(db, reviewStorage, reviewAttachment.itemKey, reviewReplacement.fileDraft.uploadRevision);
        assert.notDeepEqual(replacementCover, originalCover);
        await assert.rejects(getAdminPdfCover(db, reviewStorage, reviewAttachment.itemKey, reviewStage.fileDraft.uploadRevision), /not found/i);
        const approvedReview = await approveItemReview(db, reviewStorage, { reviewId: captured.id, expectedRevision: captured.revision }, { userId: "review-test-editor", role: "editor" }, reviewConfig);
		assert(approvedReview.review.state === "published", "Review approval did not finish");
		const displayedSnapshot = await getAdminReviewSnapshot(db, captured.id, {
			topicsEnabled: true,
		});
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
		const nextReview = await submitItemReview(db, reviewParent.itemKey, actor, reviewConfig);
		const withdrawn = await resolveItemReview(db, { reviewId: nextReview.id, expectedRevision: nextReview.revision, action: "withdrawn" }, actor);
		assert(withdrawn.state === "withdrawn", "Creator could not withdraw their review");
		await stageNativePdfRemoval(db, reviewStorage, reviewAttachment.itemKey);
		const [stillPublic] = await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, reviewAttachment.itemKey));
		assert(stillPublic?.sha256 === approvedFile.sha256, "Staging removal changed the public file before approval");
		assert(reviewStorage.publicFiles.has(stillPublic.objectPath), "Staging removal deleted the public PDF");
		await undoNativePdfRemoval(db, reviewAttachment.itemKey);
		await stageNativePdfRemoval(db, reviewStorage, reviewAttachment.itemKey);
		const removalReview = await submitItemReview(db, reviewParent.itemKey, actor, reviewConfig);
		const laterUpload = await stageNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, filename: "after-removal.pdf", expectedSizeBytes: replacementPdf.byteLength, expectedSha256: fileHash(replacementPdf), maxPdfBytes: 10_000_000 });
		reviewStorage.privateFiles.set(laterUpload.upload.path, replacementPdf);
		await completeNativePdfUpload(db, reviewStorage, { itemKey: reviewAttachment.itemKey, expectedUploadRevision: laterUpload.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		await approveItemReview(db, reviewStorage, { reviewId: removalReview.id, expectedRevision: removalReview.revision }, { userId: "review-test-editor", role: "editor" }, reviewConfig);
		const [removedFile] = await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, reviewAttachment.itemKey));
		const [preservedUpload] = await db.select().from(itemFileDraft).where(eq(itemFileDraft.itemKey, reviewAttachment.itemKey));
		assert(!removedFile, "Approved removal left the old PDF published");
		assert(preservedUpload?.objectPath === laterUpload.upload.path && reviewStorage.privateFiles.has(laterUpload.upload.path), "Approving a removal discarded a later working upload");
		assert(reviewStorage.privateFiles.has(reviewStage.upload.path), "Approving removal deleted an earlier submitted PDF");

 });
}, 120_000);

it('opens a reviewable parent draft when an attachment is added to a published record', async () => {
  await withIsolatedPublicationDatabase(async db => {
    const parent = await createNativeItemDraft(db, {itemType: 'Report', licence: { kind: 'zenodo', id: 'cc-by-4.0' }, title: 'Published report', date: '2026-09-10', creators: [{creatorType: 'author', name: 'Learning Lab'}]});
    await publishNativeItemDraft(db, parent.itemKey);
    const attachment = await createNativeItemDraft(db, {itemType: 'Attachment', title: 'New PDF', parentItem: parent.itemKey});
    const draft = await getNativeItemDraft(db, parent.itemKey);
    assert.equal(draft.payload.title, 'Published report');
    await setItemPublishingChoice(db, parent.itemKey, {route: 'zenodo', identifierPolicy: 'mint-zenodo'}, reviewConfig);
    const review = await submitItemReview(db, parent.itemKey, noFileActor, reviewConfig);
    assert.deepEqual(review.snapshot.records.map(record => record.itemKey).sort(), [parent.itemKey, attachment.itemKey].sort());
  });
});


it("migrates queued language fields without losing other pending fields or job state", async () => {
 await withIsolatedPublicationDatabase(async (_db, client) => {
  // Temp tables keep this SQL check independent of publication setup.
  await client.query(`
   CREATE TEMP TABLE "itemSourceLink" (id int, "dirtyFields" jsonb);
   CREATE TEMP TABLE "sourceWritebackJob" (id int, "dirtyFields" jsonb, attempts int);
   INSERT INTO "itemSourceLink" VALUES
    (1, '["title", "language"]'),
    (2, '["languageName", "language", "tags"]'),
    (3, '["abstractNote"]'),
    (4, '[]');
   INSERT INTO "sourceWritebackJob" SELECT id, "dirtyFields", 2 FROM "itemSourceLink";
  `);
  const migration = await readFile(new URL("../../drizzle/0061_canonical_writeback_language.sql", import.meta.url), "utf8");
  await client.query(migration);
  await client.query(migration);
  const fields = [
   { id: 1, dirtyFields: ["title", "languageName"] },
   { id: 2, dirtyFields: ["tags", "languageName"] },
   { id: 3, dirtyFields: ["abstractNote"] },
   { id: 4, dirtyFields: [] },
  ];
  assert.deepEqual((await client.query('SELECT * FROM "itemSourceLink" ORDER BY id')).rows, fields);
  assert.deepEqual((await client.query('SELECT * FROM "sourceWritebackJob" ORDER BY id')).rows, fields.map(row => ({ ...row, attempts: 2 })));
 });
}, 120_000);

it("publishes a PDF that carries the record's authors and the Crossref DOI publishing activates", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const parent = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Girls' learning in Sierra Leone", date: "2026-09-10", institution: "Learning Lab", language: "en", creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }, { creatorType: "translator", firstName: "Charles", lastName: "Babbage" }] });
		const attachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: parent.itemKey, title: "Report PDF" });
		const pdf = await createPdf("Girls' learning in Sierra Leone");
		const stage = await stageNativePdfUpload(db, storage, { itemKey: attachment.itemKey, filename: "report.pdf", expectedSizeBytes: pdf.byteLength, expectedSha256: fileHash(pdf), maxPdfBytes: 10_000_000 });
		storage.privateFiles.set(stage.upload.path, pdf);
		await completeNativePdfUpload(db, storage, { itemKey: attachment.itemKey, expectedUploadRevision: stage.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		await setItemPublishingChoice(db, parent.itemKey, { route: "crossref-zenodo", identifierPolicy: "reuse-crossref" }, reviewConfig);
		const review = await submitItemReview(db, parent.itemKey, { userId: "creator", role: "creator" }, reviewConfig);
		// Approval goes by the choice the review froze, not one changed since.
		await setItemPublishingChoice(db, parent.itemKey, { route: "zenodo", identifierPolicy: "mint-zenodo" }, reviewConfig);
		await approveItemReview(db, storage, { reviewId: review.id, expectedRevision: review.revision }, { userId: "editor", role: "editor" }, reviewConfig);

		const [published] = await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, attachment.itemKey));
		const [record] = await db.select({ DOI: item.DOI }).from(item).where(eq(item.key, parent.itemKey));
		const reading = await readPdfProperties(storage.publicFiles.get(published!.objectPath)!);
		assert(record?.DOI, "Publishing activated no Crossref DOI");
		// The translator isn't an author; the file's DOI is the one the record was published with.
		assert.deepEqual(reading.writable && { authors: reading.properties.authors, doi: reading.properties.doi }, { authors: ["Ada Lovelace"], doi: record.DOI.toLowerCase() });
	});
}, 120_000);

it("leaves a Crossref DOI reserved before the record moved to Zenodo out of its PDF", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const parent = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "A Zenodo report", date: "2026-09-10", institution: "Learning Lab", creators: [{ creatorType: "author", name: "Learning Lab" }] });
		const attachment = await createNativeItemDraft(db, { itemType: "Attachment", parentItem: parent.itemKey, title: "Report PDF" });
		const pdf = await createPdf("A Zenodo report");
		const stage = await stageNativePdfUpload(db, storage, { itemKey: attachment.itemKey, filename: "report.pdf", expectedSizeBytes: pdf.byteLength, expectedSha256: fileHash(pdf), maxPdfBytes: 10_000_000 });
		storage.privateFiles.set(stage.upload.path, pdf);
		await completeNativePdfUpload(db, storage, { itemKey: attachment.itemKey, expectedUploadRevision: stage.fileDraft.uploadRevision, maxPdfBytes: 10_000_000 });
		await setItemPublishingChoice(db, parent.itemKey, { route: "crossref-zenodo", identifierPolicy: "reuse-crossref" }, reviewConfig);
		await reserveCrossrefDoi(db, parent.itemKey, reviewConfig, "editor");
		await setItemPublishingChoice(db, parent.itemKey, { route: "zenodo", identifierPolicy: "mint-zenodo" }, reviewConfig);
		const review = await submitItemReview(db, parent.itemKey, { userId: "creator", role: "creator" }, reviewConfig);
		await approveItemReview(db, storage, { reviewId: review.id, expectedRevision: review.revision }, { userId: "editor", role: "editor" }, reviewConfig);

		const [published] = await db.select().from(itemFilePublication).where(eq(itemFilePublication.itemKey, attachment.itemKey));
		const reading = await readPdfProperties(storage.publicFiles.get(published!.objectPath)!);
		// The reservation was never registered, and Zenodo gives the record its own DOI.
		assert.equal(reading.writable && reading.properties.doi, "");
	});
}, 120_000);
