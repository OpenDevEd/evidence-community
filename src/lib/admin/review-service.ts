import { captureItemReviewSnapshot } from "./review-snapshot";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { activateCrossrefPublicationInTransaction } from "@/lib/publication/crossref-activation-service";
import { activateZenodoPublicationInTransaction } from "@/lib/publication/zenodo-activation-service";
import {
	prepareNativePdfPublication,
	unpublishNativePdfInTransaction,
	cleanupNativePdfRemoval,
} from "./native-file-service";
import type { EvidenceFileStorage } from "./file-storage";
import {
	itemDraft,
	itemIdentity,
} from "@opendeved/evidence-library-core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { lockItemMutations } from "@/db/canonical-mutation-lock";
import {
	itemFileRemoval,
	itemPublishingChoice,
	itemReview,
	itemReviewFile,
} from "@/db/schema/review";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
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
import { validateNativeItemDraft } from "./native-item-validation";
import {
	publishingChoiceSchema,
	reviewFileSchema,
	type ReviewRecord,
} from "./review-contract";

export type ReviewActor = {
	userId: string;
	role: "owner" | "editor" | "creator";
};

async function reviewChildKeys(
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

export async function setItemPublishingChoice(
	db: Database,
	itemKey: string,
	input: unknown,
) {
	const choice = publishingChoiceSchema.parse(input);
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

export async function submitItemReview(
	db: Database,
	rootKey: string,
	actor: ReviewActor,
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
		const [pending] = await transaction
			.select({ id: itemReview.id })
			.from(itemReview)
			.where(
				and(
					eq(itemReview.itemKey, rootKey),
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
					eq(itemReview.itemKey, rootKey),
					sql`${itemReview.remainingConflicts} <> '{}'::jsonb`,
				),
			)
			.limit(1);
		if (unresolved)
			throw new AdminValidationError(
				"Resolve the working draft conflicts before submitting again.",
			);
		const [choiceRow] = await transaction
			.select()
			.from(itemPublishingChoice)
			.where(eq(itemPublishingChoice.itemKey, rootKey));
		if (identity.kind === "created" && !choiceRow)
			throw new AdminValidationError(
				"Choose identifiers before submitting.",
			);
		const {records, capturedFiles} = await captureItemReviewSnapshot(transaction, rootKey, keys);
		if (!records.some((record) => record.itemKey === rootKey))
			throw new ItemNotFoundError(rootKey);
		const [review] = await transaction
			.insert(itemReview)
			.values({
				itemKey: rootKey,
				submittedBy: actor.userId,
				snapshot: {
					records,
					publishingChoice: choiceRow?.choice ?? null,
				},
			})
			.returning();
		if (capturedFiles.length)
			await transaction
				.insert(itemReviewFile)
				.values(
					capturedFiles.map(({ itemKey, file, removalId }) => ({
						reviewId: review!.id,
						itemKey,
						file,
						removalId,
						objectPath: file?.objectPath ?? null,
						coverObjectPath: file?.coverObjectPath ?? null,
					})),
				);
		return review!;
	});
}

async function lockPendingReview(transaction: DatabaseTransaction, reviewId: string, expectedRevision: number) {
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
		const review = await lockPendingReview(transaction, input.reviewId, input.expectedRevision);
		if (input.action === "returned" && actor.role === "creator")
			throw new AdminValidationError(
				"Only an Editor or Owner can return a review.",
			);
		if (
			input.action === "withdrawn" &&
			actor.role === "creator" &&
			review.submittedBy !== actor.userId
		)
			throw new AdminValidationError(
				"You can only withdraw your own submission.",
			);
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
		return updated!;
	});
}

export async function getItemReviews(db: Database, itemKey: string) {
	return db
		.select()
		.from(itemReview)
		.where(eq(itemReview.itemKey, itemKey))
		.orderBy(desc(itemReview.submittedAt))
		.limit(20);
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
		const review = await lockPendingReview(transaction, input.reviewId, input.expectedRevision);
		if (
			new Set(input.records.map((record) => record.itemKey)).size !==
			input.records.length
		)
			throw new AdminValidationError(
				"Each corrected item must be unique.",
			);
		const updates = input.records.map((record) => {
			const original = review.snapshot.records.find(
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
		});
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

export async function approveItemReview(
	db: Database,
	storage: EvidenceFileStorage,
	input: {
		reviewId: string;
		expectedRevision: number;
		publicationTags: readonly string[];
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
			if (!file.file) continue;
			const [current] = await db
				.select()
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, file.itemKey));
			if (
				current?.sourceObjectPath === file.objectPath &&
				current.sha256 === file.file.sha256
			)
				continue;
			prepared.push(
				await prepareNativePdfPublication(db, storage, {
					itemKey: file.itemKey,
					expectedUploadRevision: file.file.uploadRevision,
					publicationTags: input.publicationTags,
					reviewFile: reviewFileSchema.parse(file.file),
					zenodoFileChange: input.zenodoFileChange,
				}),
			);
		}
		committed = await db.transaction(async (transaction) => {
			const keys = review.snapshot.records.map(
				(record) => record.itemKey,
			);
			await lockItemMutations(transaction, keys);
			const locked = await lockPendingReview(transaction, review.id, review.revision);
			const current = await transaction
				.select({ key: item.key, revision: item.revision })
				.from(item)
				.where(inArray(item.key, keys))
				.for("update");
			for (const record of locked.snapshot.records) {
				if (
					(current.find(({ key }) => key === record.itemKey)
						?.revision ?? 0) !== record.baseRevision
				)
					throw new ItemDraftConflictError(record.itemKey);
			}
			const remainingConflicts: Record<string, string[]> = {};
            const indexingKeys = new Set(keys);
			// Publish the root before its attachments, within this same transaction.
			const records = [...locked.snapshot.records].sort(
				(a, b) =>
					Number(b.itemKey === locked.itemKey) -
					Number(a.itemKey === locked.itemKey),
			);
			for (const submitted of records) {
				const approved =
					locked.corrections.find(
						(record) => record.itemKey === submitted.itemKey,
					) ?? submitted;
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
				for (const record of result.indexingRecords) indexingKeys.add(record.key);
				if (result.draftConflicts.length)
					remainingConflicts[submitted.itemKey] = [
						...result.draftConflicts,
					];
			}
			const fileResults = [];
			for (const file of prepared)
				fileResults.push(await file.commit(transaction));
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
							file.itemKey,
							input.zenodoFileChange,
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
			const choice = locked.snapshot.publishingChoice;
			if (choice) {
				if (choice.route === "crossref-zenodo") {
					await activateCrossrefPublicationInTransaction(
						transaction,
						locked.itemKey,
						config,
						actor.userId,
					);
				}
				await activateZenodoPublicationInTransaction(
					transaction,
					locked.itemKey,
					config,
					choice.identifierPolicy,
					actor.userId,
					null,
				);
			}
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
            const indexingRecords = await transaction.select({ key: item.key, revision: item.revision }).from(item).where(inArray(item.key, [...indexingKeys]));
            return { fileResults, removals, review: published!, indexingRecords };
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
	return { review: committed.review, indexingRecords: committed.indexingRecords };
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
		const [review] = await transaction.select().from(itemReview).where(eq(itemReview.id, input.reviewId)).for("update");
		if (!review || review.state !== "published" || review.revision !== input.expectedRevision)
			throw new AdminValidationError("The review changed. Reload it and try again.");
		const fields = review.remainingConflicts[input.itemKey];
		if (!fields?.length || fields.length !== Object.keys(input.choices).length || fields.some(field => !input.choices[field]))
			throw new AdminValidationError("Choose a value for every conflicting field.");
		const [current] = await transaction.select().from(itemDraft).where(eq(itemDraft.itemKey, input.itemKey)).for("update");
		if (!current || current.generation !== input.generation || current.draftRevision !== input.draftRevision)
			throw new ItemDraftConflictError(input.itemKey);
		const published = await loadPublishedItemPayload(transaction, input.itemKey);
		const payload = applyItemDraftPatch(published, current.patch);
		const resolved = {...payload};
		for (const field of fields) {
			if (input.choices[field] === "published") {
				if (Object.hasOwn(published, field)) resolved[field] = published[field];
				else delete resolved[field];
			}
		}
		await saveItemDraftInTransaction(transaction, {
			itemKey: input.itemKey, expectedDraftGeneration: input.generation,
			expectedDraftRevision: input.draftRevision, expectedPayload: payload, payload: resolved,
		}, {writebackConfig: config});
		const remainingConflicts = {...review.remainingConflicts};
		delete remainingConflicts[input.itemKey];
		const [updated] = await transaction.update(itemReview).set({remainingConflicts, revision: review.revision + 1}).where(eq(itemReview.id, review.id)).returning();
		return updated!;
	});
}
