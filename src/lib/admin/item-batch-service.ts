import { itemDraft, itemIdentity } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";

import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";
import { AdminValidationError } from "./errors";
import { adminErrorDetails } from "./http";
import type {
	AdminItemBatchRequest,
	AdminItemBatchResponse,
	AdminItemBatchResult,
} from "./item-batch-contract";
import { adminSearchIndexReceipt } from "./search-index-contract";
import { effectiveItemParent } from "./item-draft-merge";
import {
	assignItemDraftToCollection,
	ItemHasChildrenError,
	ItemNotFoundError,
	ItemParentUnavailableError,
	removeNativeItem,
	type ItemWritebackPolicyOptions,
} from "./native-item-service";

type BatchDependencies = {
	db: Database;
	removePrivateFiles: (paths: string[]) => Promise<void>;
	/** Takes a removed record's attachments' public files out of public view (withdrawn-files). */
	hideRemovedFiles?: (parentKey: string) => Promise<void>;
	writebackPolicyOptions?: ItemWritebackPolicyOptions;
};

export type AdminItemBatchExecution = AdminItemBatchResponse;

async function loadBatchState(db: Database, request: AdminItemBatchRequest) {
	const [identities, drafts, published] = await Promise.all([
		db
			.select({
				key: itemIdentity.key,
				sourceConnectionKey: itemIdentity.sourceConnectionKey,
			})
			.from(itemIdentity)
			.where(inArray(itemIdentity.key, request.keys)),
		db
			.select({ itemKey: itemDraft.itemKey, patch: itemDraft.patch })
			.from(itemDraft)
			.where(inArray(itemDraft.itemKey, request.keys)),
		db
			.select({
				deleted: item.deleted,
				key: item.key,
				parentItem: item.parentItem,
			})
			.from(item)
			.where(inArray(item.key, request.keys)),
	]);
	return {
		drafts: new Map<string, (typeof drafts)[number]>(
			drafts.map((draft) => [draft.itemKey, draft]),
		),
		identities: new Map<string, (typeof identities)[number]>(
			identities.map((identity) => [identity.key, identity]),
		),
		published: new Map<string, (typeof published)[number]>(
			published.map((record) => [record.key, record]),
		),
	};
}

async function assertAssignableCollection(db: Database, collectionKey: string) {
	const [target] = await db
		.select({ key: collection.key })
		.from(collection)
		.where(
			and(eq(collection.key, collectionKey), eq(collection.deleted, 0)),
		)
		.limit(1);
	if (!target) {
		throw new AdminValidationError("Choose an active community collection.", {
			collectionKey:
				"Records can only be assigned to an active collection.",
		});
	}
}

function skipped(key: string, message: string): AdminItemBatchResult {
	return { indexingReceipts: [], key, message, outcome: "skipped" };
}

function failedBatchItem(key: string, error: unknown): AdminItemBatchResult {
	const details = adminErrorDetails(error);
	const retryable = error instanceof ItemHasChildrenError || error instanceof ItemParentUnavailableError;
	return {
		code: details.code,
		...(details.fields ? { fields: details.fields } : {}),
		key,
		indexingReceipts: [],
		message: details.message,
		outcome: "failed",
		...(retryable ? { retryable: true } : {}),
	};
}

export function orderBatchKeysByDependency(
	keys: readonly string[],
	parentByKey: ReadonlyMap<string, string | null>,
) {
	const selectedKeys = new Set(keys);
	const depths = new Map<string, number>();
	const depthOf = (key: string, path: ReadonlySet<string>): number => {
		const cached = depths.get(key);
		if (cached !== undefined) return cached;
		const parent = parentByKey.get(key);
		if (!parent || !selectedKeys.has(parent) || path.has(parent)) {
			depths.set(key, 0);
			return 0;
		}
		const nextPath = new Set(path).add(key);
		const depth = depthOf(parent, nextPath) + 1;
		depths.set(key, depth);
		return depth;
	};
	return keys
		.map((key, index) => ({ depth: depthOf(key, new Set()), index, key }))
		.sort((left, right) => {
			const depthDifference = right.depth - left.depth;
			return depthDifference || left.index - right.index;
		})
		.map(({ key }) => key);
}

/** What a removal leaves for after its transaction: its attachments' public files to hide, and discarded uploads. */
async function cleanUpRemoval(
	key: string,
	removed: { tookAttachments: boolean; stagedPrivatePaths: string[] },
	{ removePrivateFiles, hideRemovedFiles }: Pick<BatchDependencies, "removePrivateFiles" | "hideRemovedFiles">,
) {
	if (removed.tookAttachments) await hideRemovedFiles?.(key);
	if (!removed.stagedPrivatePaths.length) return;
	try {
		await removePrivateFiles(removed.stagedPrivatePaths);
	} catch (error) {
		console.error("Failed to remove discarded private file objects", error);
	}
}

async function removeBatchItem(
	key: string,
	sourceConnectionKey: string,
	{ db, removePrivateFiles, hideRemovedFiles }: BatchDependencies,
): Promise<AdminItemBatchResult> {
	if (sourceConnectionKey !== NATIVE_SOURCE_CONNECTION_KEY) {
		return skipped(key, "Remote record removal is not available yet.");
	}
	try {
		const removed = await removeNativeItem(db, key);
		await cleanUpRemoval(key, removed, { removePrivateFiles, hideRemovedFiles });
		return {
			indexingReceipts: removed.changed && removed.item
				? removed.indexingRecords.map((record) => adminSearchIndexReceipt("item", record))
				: [],
			key,
			outcome: removed.changed ? "changed" : "unchanged",
		};
	} catch (error) {
		if (error instanceof ItemNotFoundError) {
			return skipped(key, "This record is already removed.");
		}
		throw error;
	}
}

async function mutateBatchItem(
	request: AdminItemBatchRequest,
	key: string,
	sourceConnectionKey: string,
	dependencies: BatchDependencies,
): Promise<AdminItemBatchResult> {
	if (request.action === "remove") return removeBatchItem(key, sourceConnectionKey, dependencies);
	const assignment = await assignItemDraftToCollection(
		dependencies.db, key, request.collectionKey, dependencies.writebackPolicyOptions ?? {},
	);
	return {indexingReceipts: [], key, outcome: assignment.changed ? "changed" : "unchanged"};
}

export async function runAdminItemBatch(
	request: AdminItemBatchRequest,
	dependencies: BatchDependencies,
): Promise<AdminItemBatchExecution> {
	const { db } = dependencies;
	if (request.action === "assignCollection") {
		await assertAssignableCollection(db, request.collectionKey);
	}
	const state = await loadBatchState(db, request);
	const results: AdminItemBatchResult[] = [];
	const parentByKey = new Map(
		request.keys.map((key) => {
			const draftPatch = state.drafts.get(key)?.patch;
			const published = state.published.get(key);
			return [
				key,
				request.action === "remove" && published?.deleted === 0
					? published.parentItem
					: effectiveItemParent(published?.parentItem, draftPatch),
			] as const;
		}),
	);
	const mutationOrder = orderBatchKeysByDependency(
		request.keys,
		parentByKey,
	);

	// Keep mutations individually transactional while respecting parent and
	// attachment dependencies. Retry dependency failures once after the other
	// selected records have had a chance to settle.
	const mutationAttempts = mutationOrder.map((key) => ({
		allowDependencyRetry: true,
		key,
	}));
	for (let index = 0; index < mutationAttempts.length; index += 1) {
		const { allowDependencyRetry, key } = mutationAttempts[index]!;
		const identity = state.identities.get(key);
		if (!identity) {
			results.push(skipped(key, "This record is no longer available."));
			continue;
		}
		try {
			results.push(await mutateBatchItem(request, key, identity.sourceConnectionKey, dependencies));
		} catch (error) {
			const failure = failedBatchItem(key, error);
			if (allowDependencyRetry && failure.retryable) {
				mutationAttempts.push({ allowDependencyRetry: false, key });
				continue;
			}
			results.push(failure);
		}
	}

	const resultByKey = new Map(results.map((result) => [result.key, result]));
	return {
		results: request.keys.map((key) => resultByKey.get(key)!),
	};
}
