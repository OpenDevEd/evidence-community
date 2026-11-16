import { captureItemReviewSnapshot } from "./review-snapshot";
import { acceptAddedPapers } from "./added-paper-links";
import { queueSubmissionStatus } from "./submission-status";
import { readPublicationRepositorySnapshot } from "@/lib/publication/repository";
import { lockedZenodoIdentifierPolicy } from "@/lib/publication/zenodo-policy";
import { CrossrefActivationValidationError, ZenodoIdentifierPolicyLockedError } from "@/lib/publication/errors";
import { zenodoPolicyChangeReason } from "@/lib/publication/identifier-policy";
import { applySourceFileChoices, holdSourceFileChoices, releaseSourceFileChoices, unsubmittedSourcePdfChanges } from "./source-file-choice";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { activateCrossrefPublicationInTransaction, reserveCrossrefDoi } from "@/lib/publication/crossref-activation-service";
import { activateZenodoPublicationInTransaction } from "@/lib/publication/zenodo-activation-service";
import {
	prepareNativePdfPublication,
	unpublishNativePdfInTransaction,
	cleanupNativePdfRemoval,
} from "./native-file-service";
import type { EvidenceFileStorage } from "./file-storage";
import { itemDraft, itemIdentity } from "@opendeved/evidence-library-core";
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { lockItemMutations } from "@/db/canonical-mutation-lock";
import {
	itemFileRemoval,
	itemPublishingChoice,
	itemReview,
	itemReviewFile,
} from "@/db/schema/review";
import { addedPaper, itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { publicationTarget } from "@/db/schema/publication";
import { AdminValidationError } from "./errors";
import { applyItemDraftPatch } from "./item-draft-patch";
import {
	saveItemDraftInTransaction,
	publishItemDraftWithContext,
	loadPublishedItemPayload,
	loadWorkingItemPayload,
	ItemDraftConflictError,
	ItemNotFoundError,
} from "./native-item-service";
import { validateReviewPayload } from "./review-validation";
import { recordPdfProperties } from "./pdf-record-properties";
import { validateNativeItemDraft } from "./native-item-validation";
import {
	publishingChoiceSchema,
	reviewFileSchema,
	type ReviewRecord,
	type PublishingChoice,
	type PublishingChoiceState,
} from "./review-contract";

export type ReviewActor = {
	userId: string;
	role: "owner" | "editor" | "creator";
};

export async function reviewChildKeys(
	db: Database | DatabaseTransaction,
	rootKey: string,
) {
	const [published, drafts] = await Promise.all([
		db
			.select({ key: item.key })
			.from(item)
			.where(eq(item.parentItem, rootKey)),
		db
			.select({ key: itemDraft.itemKey })
			.from(itemDraft)
			.where(sql`${itemDraft.patch}->>'parentItem' = ${rootKey}`),
	]);
	return [...new Set([...published, ...drafts].map(({ key }) => key))].sort();
}

export async function getItemPublishingChoice(
	db: Database | DatabaseTransaction,
	itemKey: string,
	config: Pick<LibraryServerConfig, "services">,
): Promise<PublishingChoiceState> {
	const [record] = await db
		.select({
			choice: itemPublishingChoice.choice,
			canClear: sql<boolean>`not exists (select 1 from ${publicationTarget} where ${publicationTarget.itemKey} = ${itemIdentity.key} and ${publicationTarget.activatedAt} is not null)`,
		})
		.from(itemIdentity)
		.leftJoin(
			itemPublishingChoice,
			eq(itemPublishingChoice.itemKey, itemIdentity.key),
		)
		.where(eq(itemIdentity.key, itemKey));
	if (!record) throw new ItemNotFoundError(itemKey);
	const snapshot = await readPublicationRepositorySnapshot(db, itemKey, config.services.publication.crossref.environment);
	return {
		...record,
		lockedIdentifierPolicy: lockedZenodoIdentifierPolicy(snapshot, config.services.publication.zenodo.environment),
	};
}

/**
 * Refuses a DOI route the community can't follow, when it is chosen and again when it is submitted: one saved before
 * a provider was switched off would otherwise only fail at publishing. Every DOI here is archived on Zenodo.
 */
function assertPublishingChoiceAllowed(state: PublishingChoiceState, choice: PublishingChoice | null, config: Pick<LibraryServerConfig, "services">) {
	if (!choice) return;
	const { crossref, zenodo } = config.services.publication;
	if (!zenodo.enabled)
		throw new AdminValidationError("This community hasn't set up Zenodo, so it can't register DOIs. Switch \"Register a DOI\" off to publish without one.");
	if (choice.route === "crossref-zenodo" && !crossref.enabled)
		throw new AdminValidationError("This community hasn't set up Crossref. Choose Zenodo, or switch \"Register a DOI\" off.");
	if (zenodoPolicyChangeReason(state.lockedIdentifierPolicy, choice.identifierPolicy))
		throw new ZenodoIdentifierPolicyLockedError();
}

export async function setItemPublishingChoice(
	db: Database,
	itemKey: string,
	input: unknown,
	config: Pick<LibraryServerConfig, "services">,
) {
	const choice = publishingChoiceSchema.nullable().parse(input);
	return db.transaction(async (transaction) => {
		await lockItemMutations(transaction, [itemKey]);
		const [identity] = await transaction
			.select()
			.from(itemIdentity)
			.where(eq(itemIdentity.key, itemKey));
		if (!identity) throw new ItemNotFoundError(itemKey);
		if (identity.kind !== "created")
			throw new AdminValidationError(
				"Identifier selection is for created items.",
			);
		const payload = await loadWorkingItemPayload(transaction, itemKey);
		if (!payload.itemType) throw new ItemNotFoundError(itemKey);
		if (payload.parentItem)
			throw new AdminValidationError(
				"Choose identifiers on the parent item.",
			);
		const state = await getItemPublishingChoice(transaction, itemKey, config);
		assertPublishingChoiceAllowed(state, choice, config);
		if (choice === null) {
			if (!state.canClear)
				throw new AdminValidationError(
					"Identifiers have already been activated for this item and cannot be removed.",
				);
			await transaction
				.delete(itemPublishingChoice)
				.where(eq(itemPublishingChoice.itemKey, itemKey));
			return null;
		}
		await transaction
			.insert(itemPublishingChoice)
			.values({ itemKey, choice })
			.onConflictDoUpdate({
				target: itemPublishingChoice.itemKey,
				set: { choice, updatedAt: new Date() },
			});
		return choice;
	});
}

async function submissionPublishingChoice(
	transaction: DatabaseTransaction,
	itemKey: string,
	config: Pick<LibraryServerConfig, "services">,
) {
	const [pending] = await transaction
		.select({ id: itemReview.id })
		.from(itemReview)
		.where(
			and(
				eq(itemReview.itemKey, itemKey),
				eq(itemReview.state, "pending"),
			),
		);
	if (pending)
		throw new AdminValidationError(
			"This item already has a pending review.",
		);
	const [unresolved] = await transaction
		.select({ id: itemReview.id })
		.from(itemReview)
		.where(
			and(
				eq(itemReview.itemKey, itemKey),
				sql`${itemReview.remainingConflicts} <> '{}'::jsonb`,
			),
		)
		.limit(1);
	if (unresolved)
		throw new AdminValidationError(
			"Resolve the working draft conflicts before submitting again.",
		);
	const state = await getItemPublishingChoice(transaction, itemKey, config);
	assertPublishingChoiceAllowed(state, state.choice, config);
	return state.choice;
}

export async function submitItemReview(
	db: Database,
	rootKey: string,
	actor: ReviewActor,
	config: Pick<LibraryServerConfig, "services">,
	/** Written in the same transaction, so it holds only if the submission does. */
	alongside?: (transaction: DatabaseTransaction, review: typeof itemReview.$inferSelect) => Promise<unknown>,
) {
	return db.transaction(async (transaction) => {
		const children = await reviewChildKeys(transaction, rootKey);
		const keys = [rootKey, ...children];
		await lockItemMutations(transaction, keys);
		const identities = await transaction
			.select()
			.from(itemIdentity)
			.where(inArray(itemIdentity.key, keys))
			.for("update");
		const identity = identities.find(({ key }) => key === rootKey);
		if (!identity) throw new ItemNotFoundError(rootKey);
		// Native child creation locks its parent identity before adding the child.
		if (
			JSON.stringify(children) !==
			JSON.stringify(await reviewChildKeys(transaction, rootKey))
		)
			throw new ItemDraftConflictError(rootKey);
		const publishingChoice = await submissionPublishingChoice(
			transaction,
			rootKey,
			config,
		);
		const { records, capturedFiles } = await captureItemReviewSnapshot(
			transaction,
			rootKey,
			keys,
			publishingChoice,
		);
		if (!records.some((record) => record.itemKey === rootKey))
			throw new ItemNotFoundError(rootKey);
		// Only the PDFs the review shows go with it; a child moving to another record keeps its own.
		const sourcePdfChanges = await unsubmittedSourcePdfChanges(transaction, records.map((record) => record.itemKey));
		const [review] = await transaction
			.insert(itemReview)
			.values({
				itemKey: rootKey,
				submittedBy: actor.userId,
				snapshot: {
					records,
					publishingChoice,
					...(sourcePdfChanges.length ? { sourcePdfChanges } : {}),
				},
			})
			.returning();
		await holdSourceFileChoices(transaction, review!.id, sourcePdfChanges.map((change) => change.itemKey));
		// Sent again, an added paper waits for review again: that supersedes any earlier word still on its way.
		await queueSubmissionStatus(transaction, [rootKey]);
		if (capturedFiles.length)
			await transaction.insert(itemReviewFile).values(
				capturedFiles.map(({ itemKey, file, removalId }) => ({
					reviewId: review!.id,
					itemKey,
					file,
					removalId,
					objectPath: file?.objectPath ?? null,
					coverObjectPath: file?.coverObjectPath ?? null,
				})),
			);
		await alongside?.(transaction, review!);
		return review!;
	});
}

async function lockPendingReview(
	transaction: DatabaseTransaction,
	reviewId: string,
	expectedRevision: number,
) {
	const [review] = await transaction
		.select()
		.from(itemReview)
		.where(eq(itemReview.id, reviewId))
		.for("update");
	if (
		!review ||
		review.state !== "pending" ||
		review.revision !== expectedRevision
	)
		throw new AdminValidationError(
			"The review changed. Reload it and try again.",
		);
	return review;
}

const isAddedPaper = async (transaction: DatabaseTransaction, itemKey: string) =>
	(await transaction.select({ itemKey: addedPaper.itemKey }).from(addedPaper).where(eq(addedPaper.itemKey, itemKey)).limit(1)).length > 0;

/** Refuses what the person may not do to the review: only the team returns one, and a Creator withdraws only their own. */
async function assertMayResolve(transaction: DatabaseTransaction, review: { itemKey: string; submittedBy: string }, action: "returned" | "withdrawn", actor: ReviewActor) {
	if (action === "returned" && actor.role === "creator") throw new AdminValidationError("Only an Editor or Owner can return a review.");
	if (action !== "withdrawn" || review.submittedBy === actor.userId) return;
	if (actor.role === "creator") throw new AdminValidationError("You can only withdraw your own submission.");
	// A paper someone sent can't be changed by them, only sent again: the team declines it with a reason they read.
	if (await isAddedPaper(transaction, review.itemKey)) throw new AdminValidationError("Only the person who sent this paper can withdraw it. Decline it with a reason instead.");
}

export async function resolveItemReview(
	db: Database,
	input: {
		reviewId: string;
		expectedRevision: number;
		action: "returned" | "withdrawn";
		note?: string;
	},
	actor: ReviewActor,
) {
	return db.transaction(async (transaction) => {
		const review = await lockPendingReview(
			transaction,
			input.reviewId,
			input.expectedRevision,
		);
		await assertMayResolve(transaction, review, input.action, actor);
		await releaseSourceFileChoices(transaction, review.id);
		const [updated] = await transaction
			.update(itemReview)
			.set({
				state: input.action,
				note: input.note?.trim() || null,
				resolvedBy: actor.userId,
				resolvedAt: new Date(),
				revision: review.revision + 1,
			})
			.where(eq(itemReview.id, review.id))
			.returning();
		await queueSubmissionStatus(transaction, [review.itemKey]);
		return updated!;
	});
}

// A record's review history goes to anyone on the team, so it leaves out who sent each paper: their email is for
// the Editors and Owners who decide it, through the review snapshot.
const { sender: _sender, ...historyColumns } = getTableColumns(itemReview);

export async function getItemReviews(db: Database, itemKey: string) {
	return db
		.select(historyColumns)
		.from(itemReview)
		.where(eq(itemReview.itemKey, itemKey))
		.orderBy(desc(itemReview.submittedAt))
		.limit(20);
}

function correctedReviewRecord(
	record: ReviewRecord,
	submitted: ReviewRecord[],
) {
	const original = submitted.find(
		(entry) => entry.itemKey === record.itemKey,
	);
	if (!original)
		throw new AdminValidationError(
			"This item is not in the submitted review.",
		);
	const validated = validateNativeItemDraft(record.payload, {
		requireTitle: true,
	});
	if (
		(validated.item.parentItem ?? null) !==
		(original.payload.parentItem ?? null)
	)
		throw new AdminValidationError(
			"A review correction cannot move an attachment to another item.",
		);
	return { ...original, payload: validated.payload };
}

export async function correctItemReview(
	db: Database,
	input: {
		reviewId: string;
		expectedRevision: number;
		records: ReviewRecord[];
	},
	actor: ReviewActor,
) {
	if (actor.role === "creator")
		throw new AdminValidationError(
			"Only an Editor or Owner can correct a review.",
		);
	return db.transaction(async (transaction) => {
		const review = await lockPendingReview(
			transaction,
			input.reviewId,
			input.expectedRevision,
		);
		if (
			new Set(input.records.map((record) => record.itemKey)).size !==
			input.records.length
		)
			throw new AdminValidationError(
				"Each corrected item must be unique.",
			);
		const updates = input.records.map((record) =>
			correctedReviewRecord(record, review.snapshot.records),
		);
		const corrections = [
			...review.corrections.filter(
				(record) =>
					!updates.some(
						(update) => update.itemKey === record.itemKey,
					),
			),
			...updates,
		];
		const [updated] = await transaction
			.update(itemReview)
			.set({ corrections, revision: review.revision + 1 })
			.where(eq(itemReview.id, review.id))
			.returning();
		return updated!;
	});
}

/** A record the review only shows: captured without a draft, and not corrected since. */
function isUnchangedReviewRecord(review: typeof itemReview.$inferSelect, record: ReviewRecord) {
	return record.unchanged === true && !review.corrections.some((correction) => correction.itemKey === record.itemKey);
}

function effectiveReviewRecord(
	review: typeof itemReview.$inferSelect,
	submitted: ReviewRecord,
) {
	return (
		review.corrections.find(
			(record) => record.itemKey === submitted.itemKey,
		) ?? submitted
	);
}

export async function publishReviewRecords(
	transaction: DatabaseTransaction,
	locked: typeof itemReview.$inferSelect,
	config: LibraryServerConfig,
) {
	const remainingConflicts: Record<string, string[]> = {};
	const indexingKeys = new Set(
		locked.snapshot.records.map((record) => record.itemKey),
	);
	// Publish the root before its attachments, within this same transaction.
	const records = [...locked.snapshot.records].sort(
		(a, b) =>
			Number(b.itemKey === locked.itemKey) -
			Number(a.itemKey === locked.itemKey),
	);
	for (const submitted of records) {
		if (isUnchangedReviewRecord(locked, submitted)) continue;
		const approved = effectiveReviewRecord(locked, submitted);
		const [latest] = await transaction
			.select({ revision: item.revision })
			.from(item)
			.where(eq(item.key, submitted.itemKey));
		const result = await publishItemDraftWithContext(
			transaction,
			submitted.itemKey,
			{
				writebackConfig: config,
				review: {
					submitted: {
						...submitted,
						baseRevision: latest?.revision ?? 0,
					},
					approved,
				},
			},
		);
		for (const record of result.indexingRecords)
			indexingKeys.add(record.key);
		if (result.draftConflicts.length)
			remainingConflicts[submitted.itemKey] = [...result.draftConflicts];
	}
	return { remainingConflicts, indexingKeys };
}

/** Activates the identifiers a publishing choice asks for, inside the publishing transaction. No provider calls. */
export async function activateChosenIdentifiers(
	transaction: DatabaseTransaction,
	itemKey: string,
	choice: PublishingChoice | null,
	config: LibraryServerConfig,
	requestedBy: string,
) {
	if (!choice) return;
	if (choice.route === "crossref-zenodo")
		await activateCrossrefPublicationInTransaction(transaction, itemKey, config, requestedBy);
	await activateZenodoPublicationInTransaction(transaction, itemKey, config, choice.identifierPolicy, requestedBy, null);
}

/** Throws when a record changed after it was submitted, so the review is no longer what would be published. */
export async function assertReviewCurrent(
	transaction: DatabaseTransaction,
	review: typeof itemReview.$inferSelect,
) {
	const current = await transaction
		.select({ key: item.key, revision: item.revision })
		.from(item)
		.where(inArray(item.key, review.snapshot.records.map((record) => record.itemKey)))
		.for("update");
	for (const record of review.snapshot.records) {
		if (isUnchangedReviewRecord(review, record)) continue;
		if (
			(current.find(({ key }) => key === record.itemKey)
				?.revision ?? 0) !== record.baseRevision
		)
			throw new AdminValidationError(
				`${record.itemKey} changed after submission. Withdraw or return this review, then submit it again.`,
			);
	}
}

/** Throws what stops a review from publishing: missing fields, including those its identifier choice needs. */
export function assertReviewPublishable(review: typeof itemReview.$inferSelect) {
	for (const record of review.snapshot.records) {
		if (isUnchangedReviewRecord(review, record)) continue;
		validateReviewPayload(
			effectiveReviewRecord(review, record).payload,
			record.itemKey === review.itemKey
				? review.snapshot.publishingChoice
				: null,
		);
	}
}

async function removeApprovedFiles(
	transaction: DatabaseTransaction,
	publication: LibraryServerConfig["services"]["publication"],
	files: (typeof itemReviewFile.$inferSelect)[],
	zenodoFileChange: "minor_correction" | undefined,
) {
	const removals = [];
	for (const file of files.filter((entry) => entry.file === null)) {
		const [currentFile] = await transaction
			.select({ key: itemFilePublication.itemKey })
			.from(itemFilePublication)
			.where(eq(itemFilePublication.itemKey, file.itemKey));
		if (currentFile)
			removals.push(
				await unpublishNativePdfInTransaction(
					transaction,
					publication,
					file.itemKey,
					zenodoFileChange,
				),
			);
		if (file.removalId)
			await transaction
				.delete(itemFileRemoval)
				.where(
					and(
						eq(itemFileRemoval.itemKey, file.itemKey),
						eq(itemFileRemoval.id, file.removalId),
					),
				);
	}
	return removals;
}

/** The record as approved, with the editor's corrections, as publishing uses it; the published one when the review doesn't hold it. */
async function approvedPayload(db: Database, review: typeof itemReview.$inferSelect, itemKey: string) {
	const submitted = review.snapshot.records.find((record) => record.itemKey === itemKey);
	return submitted ? effectiveReviewRecord(review, submitted).payload : loadPublishedItemPayload(db, itemKey);
}

/**
 * Whether the record publishes through Crossref under the choice the review
 * froze. Its Crossref DOI is reserved now so its file can carry it, and
 * publishing activates the same one. One it can't reserve is left to
 * publishing, which says why.
 */
async function reserveCrossrefDoiForFile(db: Database, config: LibraryServerConfig, review: typeof itemReview.$inferSelect, itemKey: string, payload: Record<string, unknown>, requestedBy: string) {
	const choice = itemKey === review.itemKey ? review.snapshot.publishingChoice : null;
	if (choice?.route !== "crossref-zenodo") return false;
	if (!payload.DOI)
		await reserveCrossrefDoi(db, itemKey, config, requestedBy, choice).catch((error: unknown) => {
			if (!(error instanceof CrossrefActivationValidationError)) throw error;
		});
	return true;
}

/**
 * A submitted PDF made ready to publish with the approved record written into
 * it; null when it has no upload or is already the published one.
 */
async function prepareReviewFile(
	db: Database,
	storage: EvidenceFileStorage,
	review: typeof itemReview.$inferSelect,
	file: typeof itemReviewFile.$inferSelect,
	input: { publicationTags: readonly string[]; zenodoFileChange?: "minor_correction" },
	actor: ReviewActor,
	config: LibraryServerConfig,
) {
	if (!file.file) return null;
	const [current] = await db
		.select()
		.from(itemFilePublication)
		.where(eq(itemFilePublication.itemKey, file.itemKey));
	// Each upload has its own path, so the same path is the same PDF. The
	// published copy's hash differs from the upload's: it carries the record.
	if (current?.sourceObjectPath === file.objectPath) return null;
	const parentKey = file.file.parentItemKey;
	const payload = await approvedPayload(db, review, parentKey);
	const crossref = await reserveCrossrefDoiForFile(db, config, review, parentKey, payload, actor.userId);
	return prepareNativePdfPublication(db, storage, config.services.publication, {
		itemKey: file.itemKey,
		expectedUploadRevision: file.file.uploadRevision,
		properties: await recordPdfProperties(db, config, parentKey, payload, { crossref }),
		publicationTags: input.publicationTags,
		reviewFile: reviewFileSchema.parse(file.file),
		zenodoFileChange: input.zenodoFileChange,
	});
}

export async function approveItemReview(
	db: Database,
	storage: EvidenceFileStorage,
	input: {
		reviewId: string;
		expectedRevision: number;
		zenodoFileChange?: "minor_correction";
	},
	actor: ReviewActor,
	config: LibraryServerConfig,
) {
	if (actor.role === "creator")
		throw new AdminValidationError(
			"Only an Editor or Owner can publish a review.",
		);
	const [review] = await db
		.select()
		.from(itemReview)
		.where(eq(itemReview.id, input.reviewId));
	if (
		!review ||
		review.state !== "pending" ||
		review.revision !== input.expectedRevision
	)
		throw new AdminValidationError(
			"The review changed. Reload it and try again.",
		);
	assertReviewPublishable(review);
	const files = await db
		.select()
		.from(itemReviewFile)
		.where(eq(itemReviewFile.reviewId, review.id));
	const prepared: Awaited<ReturnType<typeof prepareNativePdfPublication>>[] =
		[];
	let committed: {
		fileResults: Awaited<ReturnType<(typeof prepared)[number]["commit"]>>[];
		removals: Awaited<ReturnType<typeof unpublishNativePdfInTransaction>>[];
		review: typeof itemReview.$inferSelect;
		indexingRecords: { key: string; revision: number }[];
	};
	try {
		for (const file of files) {
			// Each Zotero group's publish tag is added when the PDF is written back to it, so none is stored here.
			const next = await prepareReviewFile(db, storage, review, file, { ...input, publicationTags: [] }, actor, config);
			if (next) prepared.push(next);
		}
		committed = await db.transaction(async (transaction) => {
			const keys = review.snapshot.records.map(
				(record) => record.itemKey,
			);
			await lockItemMutations(transaction, keys);
			const locked = await lockPendingReview(
				transaction,
				review.id,
				review.revision,
			);
			await assertReviewCurrent(transaction, locked);
			const { remainingConflicts, indexingKeys } =
				await publishReviewRecords(transaction, locked, config);
			const fileResults = [];
			for (const file of prepared)
				fileResults.push(await file.commit(transaction));
			const removals = await removeApprovedFiles(
				transaction,
				config.services.publication,
				files,
				input.zenodoFileChange,
			);
			await applySourceFileChoices(transaction, locked.id);
			await activateChosenIdentifiers(transaction, locked.itemKey, locked.snapshot.publishingChoice, config, actor.userId);
			// A paper added by DOI or OpenAlex ID is accepted with its record, and kept up to date from now on.
			await acceptAddedPapers(transaction, keys);
			await queueSubmissionStatus(transaction, keys);
			const [published] = await transaction
				.update(itemReview)
				.set({
					state: "published",
					remainingConflicts,
					resolvedBy: actor.userId,
					resolvedAt: new Date(),
					revision: locked.revision + 1,
				})
				.where(eq(itemReview.id, locked.id))
				.returning();
			const indexingRecords = await transaction
				.select({ key: item.key, revision: item.revision })
				.from(item)
				.where(inArray(item.key, [...indexingKeys]));
			return {
				fileResults,
				removals,
				review: published!,
				indexingRecords,
			};
		});
	} catch (error) {
		await Promise.all(prepared.map((file) => file.rollback()));
		throw error;
	}
	await Promise.all([
		...prepared.map((file, index) =>
			file.cleanup(committed.fileResults[index]!),
		),
		...committed.removals.map((removal) =>
			cleanupNativePdfRemoval(db, storage, removal),
		),
	]);
	return {
		review: committed.review,
		indexingRecords: committed.indexingRecords,
	};
}

function requiredConflictFields(
	review: typeof itemReview.$inferSelect,
	itemKey: string,
	choices: Record<string, "draft" | "published">,
) {
	const fields = review.remainingConflicts[itemKey];
	if (
		!fields?.length ||
		fields.length !== Object.keys(choices).length ||
		fields.some((field) => !choices[field])
	)
		throw new AdminValidationError(
			"Choose a value for every conflicting field.",
		);
	return fields;
}

function resolveConflictPayload(
	payload: Record<string, unknown>,
	published: Record<string, unknown>,
	fields: string[],
	choices: Record<string, "draft" | "published">,
) {
	const resolved = { ...payload };
	for (const field of fields) {
		if (choices[field] === "published") {
			if (Object.hasOwn(published, field))
				resolved[field] = published[field];
			else delete resolved[field];
		}
	}
	return resolved;
}

export async function resolveReviewConflicts(
	db: Database,
	input: {
		reviewId: string;
		expectedRevision: number;
		itemKey: string;
		generation: string;
		draftRevision: number;
		choices: Record<string, "draft" | "published">;
	},
	config: LibraryServerConfig,
) {
	return db.transaction(async (transaction) => {
		await lockItemMutations(transaction, [input.itemKey]);
		const [review] = await transaction
			.select()
			.from(itemReview)
			.where(eq(itemReview.id, input.reviewId))
			.for("update");
		if (
			!review ||
			review.state !== "published" ||
			review.revision !== input.expectedRevision
		)
			throw new AdminValidationError(
				"The review changed. Reload it and try again.",
			);
		const fields = requiredConflictFields(
			review,
			input.itemKey,
			input.choices,
		);
		const [current] = await transaction
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, input.itemKey))
			.for("update");
		if (
			!current ||
			current.generation !== input.generation ||
			current.draftRevision !== input.draftRevision
		)
			throw new ItemDraftConflictError(input.itemKey);
		const published = await loadPublishedItemPayload(
			transaction,
			input.itemKey,
		);
		const payload = applyItemDraftPatch(published, current.patch);
		const resolved = resolveConflictPayload(
			payload,
			published,
			fields,
			input.choices,
		);
		await saveItemDraftInTransaction(
			transaction,
			{
				itemKey: input.itemKey,
				expectedDraftGeneration: input.generation,
				expectedDraftRevision: input.draftRevision,
				expectedPayload: payload,
				payload: resolved,
			},
			{ writebackConfig: config },
		);
		const remainingConflicts = { ...review.remainingConflicts };
		delete remainingConflicts[input.itemKey];
		const [updated] = await transaction
			.update(itemReview)
			.set({ remainingConflicts, revision: review.revision + 1 })
			.where(eq(itemReview.id, review.id))
			.returning();
		return updated!;
	});
}
