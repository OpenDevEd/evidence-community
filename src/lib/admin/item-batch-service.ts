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
import {
	assignNativeItemDraftToCollection,
	NativeItemHasChildrenError,
	NativeItemNotFoundError,
	NativeItemParentUnavailableError,
	publishNativeItemDraftWithContext,
	removeNativeItem,
} from "./native-item-service";

type RevalidationTarget = {
	itemKey: string;
	parentItem: string | null;
	previousParentItem?: string | null;
};

type BatchDependencies = {
	db: Database;
	removePrivateFiles: (paths: string[]) => Promise<void>;
};

export type AdminItemBatchExecution = AdminItemBatchResponse & {
	revalidationTargets: RevalidationTarget[];
};

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
			.select({ itemKey: itemDraft.itemKey, payload: itemDraft.payload })
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
			and(
				eq(collection.key, collectionKey),
				eq(
					collection.sourceConnectionKey,
					NATIVE_SOURCE_CONNECTION_KEY,
				),
				eq(collection.deleted, 0),
			),
		)
		.limit(1);
	if (!target) {
		throw new AdminValidationError("Choose an active library collection.", {
			collectionKey:
				"Records can only be assigned to an active collection created in this library.",
		});
	}
}

function skipped(key: string, message: string): AdminItemBatchResult {
	return { key, message, outcome: "skipped" };
}

export function orderBatchKeysByDependency(
	action: AdminItemBatchRequest["action"],
	keys: readonly string[],
	parentByKey: ReadonlyMap<string, string | null>,
) {
	if (action === "assignCollection") return [...keys];
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
			const depthDifference =
				action === "publish"
					? left.depth - right.depth
					: right.depth - left.depth;
			return depthDifference || left.index - right.index;
		})
		.map(({ key }) => key);
}

export async function runAdminItemBatch(
	request: AdminItemBatchRequest,
	{ db, removePrivateFiles }: BatchDependencies,
): Promise<AdminItemBatchExecution> {
	if (request.action === "assignCollection") {
		await assertAssignableCollection(db, request.collectionKey);
	}
	const state = await loadBatchState(db, request);
	const results: AdminItemBatchResult[] = [];
	const revalidationTargets: RevalidationTarget[] = [];
	const parentByKey = new Map(
		request.keys.map((key) => {
			const draftParent = state.drafts.get(key)?.payload.parentItem;
			const published = state.published.get(key);
			return [
				key,
				request.action === "remove" && published?.deleted === 0
					? published.parentItem
					: typeof draftParent === "string"
						? draftParent
						: (published?.parentItem ?? null),
			] as const;
		}),
	);
	const mutationOrder = orderBatchKeysByDependency(
		request.action,
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
		if (identity.sourceConnectionKey !== NATIVE_SOURCE_CONNECTION_KEY) {
			results.push(
				skipped(key, "Imported records are read only in this version."),
			);
			continue;
		}

		try {
			if (request.action === "publish") {
				let publishedContext;
				try {
					publishedContext = await publishNativeItemDraftWithContext(
						db,
						key,
					);
				} catch (error) {
					if (error instanceof NativeItemNotFoundError) {
						results.push(
							skipped(
								key,
								"This record has no draft to publish.",
							),
						);
						continue;
					}
					throw error;
				}
				const { item: published, previousParentItem } =
					publishedContext;
				results.push({ key, outcome: "changed" });
				revalidationTargets.push({
					itemKey: published.key,
					parentItem: published.parentItem,
					previousParentItem,
				});
				continue;
			}

			if (request.action === "remove") {
				try {
					const removed = await removeNativeItem(db, key);
					results.push({
						key,
						outcome: removed.changed ? "changed" : "unchanged",
					});
					if (removed.changed && removed.item) {
						revalidationTargets.push({
							itemKey: removed.item.key,
							parentItem: removed.item.parentItem,
						});
					}
					if (removed.stagedPrivatePaths.length > 0) {
						try {
							await removePrivateFiles(
								removed.stagedPrivatePaths,
							);
						} catch (error) {
							console.error(
								"Failed to remove discarded private file objects",
								error,
							);
						}
					}
					continue;
				} catch (error) {
					if (error instanceof NativeItemNotFoundError) {
						results.push(
							skipped(key, "This record is already removed."),
						);
						continue;
					}
					throw error;
				}
			}

			const assignment = await assignNativeItemDraftToCollection(
				db,
				key,
				request.collectionKey,
			);
			results.push({
				key,
				outcome: assignment.changed ? "changed" : "unchanged",
			});
		} catch (error) {
			if (
				allowDependencyRetry &&
				(error instanceof NativeItemHasChildrenError ||
					error instanceof NativeItemParentUnavailableError)
			) {
				mutationAttempts.push({ allowDependencyRetry: false, key });
				continue;
			}
			const details = adminErrorDetails(error);
			results.push({
				code: details.code,
				...(details.fields ? { fields: details.fields } : {}),
				key,
				message: details.message,
				outcome: "failed",
			});
		}
	}

	const resultByKey = new Map(results.map((result) => [result.key, result]));
	return {
		results: request.keys.map((key) => resultByKey.get(key)!),
		revalidationTargets,
	};
}
