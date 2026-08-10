import {
	collectionIdentity,
	generateCanonicalRecordKey,
	itemDraft,
	itemIdentity,
	outbox,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, or } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { adminItemListProjection } from "../src/db/schema/tables/adminItemListProjection";
import { collection } from "../src/db/schema/tables/collection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import type {
	AdminItemBatchRequest,
	AdminItemBatchResponse,
	AdminItemBatchResult,
} from "../src/lib/admin/item-batch-contract";

const baseUrl = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...init?.headers,
		},
	});
	const body = (await response.json().catch(() => null)) as T | null;
	if (!response.ok) {
		throw new Error(
			`${init?.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
		);
	}
	assert(body !== null, `${init?.method ?? "GET"} ${path} returned no JSON`);
	return body;
}

async function createDraft(payload: Record<string, unknown>) {
	const response = await requestJson<{ draft: { itemKey: string } }>(
		"/api/admin/items/drafts",
		{ body: JSON.stringify(payload), method: "POST" },
	);
	return response.draft.itemKey;
}

async function runBatch(input: AdminItemBatchRequest) {
	return (
		await requestJson<AdminItemBatchResponse>("/api/admin/items/batch", {
			body: JSON.stringify(input),
			method: "POST",
		})
	).results;
}

async function assertChangedReceiptsExist(
	db: ReturnType<typeof createPostgresDatabaseResource>["database"],
	results: AdminItemBatchResult[],
	context: string,
) {
	const receipts = results.flatMap((result) =>
		result.outcome === "changed" ? (result.indexingReceipts ?? []) : [],
	);
	const changed = results.filter(({ outcome }) => outcome === "changed");
	assert(
		changed.every(
			(result) => (result.indexingReceipts?.length ?? 0) > 0,
		),
		`${context} omitted a changed record receipt: ${JSON.stringify(results)}`,
	);
	if (receipts.length === 0) return;
	const rows = await db
		.select({
			entityKey: outbox.entityKey,
			entityType: outbox.entityType,
			revision: outbox.revision,
		})
		.from(outbox)
		.where(
			or(
				...receipts.map((receipt) =>
					and(
						eq(outbox.entityType, receipt.entityType),
						eq(outbox.entityKey, receipt.entityKey),
						eq(outbox.revision, receipt.revision),
					),
				),
			),
		);
	assert(
		rows.length === receipts.length,
		`${context} returned receipts that do not match its outbox rows`,
	);
}

async function getItem(key: string) {
	return (
		await requestJson<{
			item: {
				collectionKeys: string[];
				draft: {
					draftRevision: number;
					payload: Record<string, unknown>;
				} | null;
				key: string;
				parentItem: string | null;
				state: string;
			};
		}>(`/api/admin/items/${key}`)
	).item;
}

async function openDraft(key: string) {
	return (
		await requestJson<{
			draft: {
				draftRevision: number;
				payload: Record<string, unknown>;
			};
		}>(`/api/admin/items/${key}/draft`, { method: "POST" })
	).draft;
}

async function saveDraft(
	key: string,
	expectedDraftRevision: number,
	expectedPayload: Record<string, unknown>,
	payload: Record<string, unknown>,
) {
	await requestJson(`/api/admin/items/${key}/draft`, {
		body: JSON.stringify({
			expectedDraftRevision,
			expectedPayload,
			payload,
		}),
		method: "PUT",
	});
}

async function missingItemKey(
	db: ReturnType<typeof createPostgresDatabaseResource>["database"],
) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const candidate = generateCanonicalRecordKey();
		const [existing] = await db
			.select({ key: itemIdentity.key })
			.from(itemIdentity)
			.where(eq(itemIdentity.key, candidate))
			.limit(1);
		if (!existing) return candidate;
	}
	throw new Error("Could not reserve an unused verification key");
}

async function verify() {
	const database = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = database.database;
	const itemKeys: string[] = [];
	let collectionKey: string | null = null;

	try {
		const createdCollection = await requestJson<{
			collection: { key: string };
		}>("/api/admin/collections", {
			body: JSON.stringify({
				name: `Batch verification ${Date.now()}`,
				parentCollection: null,
				sourceConnectionKey: "native",
			}),
			method: "POST",
		});
		collectionKey = createdCollection.collection.key;

		const parentKey = await createDraft({
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: "Batch verification parent",
		});
		itemKeys.push(parentKey);
		const siblingKey = await createDraft({
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: "Batch verification sibling",
		});
		itemKeys.push(siblingKey);
		const childKey = await createDraft({
			collections: [],
			itemType: "Note",
			note: "Batch verification child",
			parentItem: parentKey,
			tags: [],
		});
		itemKeys.push(childKey);

		const assignments = await runBatch({
			action: "assignCollection",
			collectionKey,
			keys: [parentKey, siblingKey],
		});
		assert(
			assignments.every(({ outcome }) => outcome === "changed"),
			`Batch assignment failed: ${JSON.stringify(assignments)}`,
		);
		for (const key of [parentKey, siblingKey]) {
			const assigned = await getItem(key);
			assert(
				Array.isArray(assigned.draft?.payload.collections) &&
					assigned.draft.payload.collections.includes(collectionKey),
				`Collection assignment was not saved for ${key}`,
			);
		}
		const parentBeforeRepeat = await getItem(parentKey);
		const repeatedAssignment = await runBatch({
			action: "assignCollection",
			collectionKey,
			keys: [parentKey],
		});
		assert(
			repeatedAssignment[0]?.outcome === "unchanged",
			`Repeated assignment was not idempotent: ${JSON.stringify(repeatedAssignment)}`,
		);
		const parentAfterRepeat = await getItem(parentKey);
		assert(
			parentAfterRepeat.draft?.draftRevision ===
				parentBeforeRepeat.draft?.draftRevision,
			"Repeated assignment unexpectedly rewrote the draft",
		);

		const publications = await runBatch({
			action: "publish",
			keys: [childKey, siblingKey, parentKey],
		});
		assert(
			publications.every(({ outcome }) => outcome === "changed"),
			`Dependency-ordered publication failed: ${JSON.stringify(publications)}`,
		);
		await assertChangedReceiptsExist(db, publications, "Batch publication");
		const publishedParent = await getItem(parentKey);
		const publishedChild = await getItem(childKey);
		assert(
			publishedParent.state === "published" &&
				publishedParent.collectionKeys.includes(collectionKey),
			"Published parent has the wrong state or collection",
		);
		assert(
			publishedChild.state === "published" &&
				publishedChild.parentItem === parentKey,
			"Child was not published after its parent",
		);
		await openDraft(siblingKey);

		const unusedKey = await missingItemKey(db);
		const mixedRemovals = await runBatch({
			action: "remove",
			keys: [parentKey, siblingKey, unusedKey],
		});
		assert(
			mixedRemovals[0]?.outcome === "failed" &&
				mixedRemovals[1]?.outcome === "changed" &&
				mixedRemovals[2]?.outcome === "skipped",
			`Mixed batch outcomes were wrong: ${JSON.stringify(mixedRemovals)}`,
		);
		await assertChangedReceiptsExist(db, mixedRemovals, "Mixed batch removal");
		assert(
			(await getItem(parentKey)).state === "published" &&
				(await getItem(childKey)).state === "published" &&
				(await getItem(siblingKey)).state === "deleted" &&
				(await getItem(siblingKey)).draft === null,
			"Mixed batch persistence did not match its outcomes",
		);

		const removals = await runBatch({
			action: "remove",
			keys: [parentKey, childKey],
		});
		assert(
			removals.every(({ outcome }) => outcome === "changed"),
			`Dependency-ordered removal failed: ${JSON.stringify(removals)}`,
		);
		await assertChangedReceiptsExist(db, removals, "Batch removal");
		for (const key of itemKeys) {
			assert(
				(await getItem(key)).state === "deleted",
				`Removed record ${key} is not deleted`,
			);
		}

		const oldParentKey = await createDraft({
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: "Batch ordering old parent",
		});
		itemKeys.push(oldParentKey);
		const newParentKey = await createDraft({
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: "Batch ordering new parent",
		});
		itemKeys.push(newParentKey);
		const reparentedChildKey = await createDraft({
			collections: [],
			itemType: "Note",
			note: "Batch ordering child",
			parentItem: oldParentKey,
			tags: [],
		});
		itemKeys.push(reparentedChildKey);
		const initialFamilyPublication = await runBatch({
			action: "publish",
			keys: [reparentedChildKey, newParentKey, oldParentKey],
		});
		assert(
			initialFamilyPublication.every(
				({ outcome }) => outcome === "changed",
			),
			`Reparenting fixture could not publish: ${JSON.stringify(initialFamilyPublication)}`,
		);
		const reparentedChildDraft = await openDraft(reparentedChildKey);
		await saveDraft(
			reparentedChildKey,
			reparentedChildDraft.draftRevision,
			reparentedChildDraft.payload,
			{
				...reparentedChildDraft.payload,
				parentItem: newParentKey,
			},
		);
		const divergentParentRemovals = await runBatch({
			action: "remove",
			keys: [oldParentKey, reparentedChildKey],
		});
		assert(
			divergentParentRemovals.every(
				({ outcome }) => outcome === "changed",
			),
			`Removal used the draft parent instead of the published parent: ${JSON.stringify(divergentParentRemovals)}`,
		);
		const newParentRemoval = await runBatch({
			action: "remove",
			keys: [newParentKey],
		});
		assert(
			newParentRemoval[0]?.outcome === "changed",
			`New parent cleanup failed: ${JSON.stringify(newParentRemoval)}`,
		);

		const boundaryParentKey = await createDraft({
			collections: [],
			creators: [],
			itemType: "Report",
			tags: [],
			title: "Cross-chunk boundary parent",
		});
		itemKeys.push(boundaryParentKey);
		const boundaryChildKey = await createDraft({
			collections: [],
			itemType: "Note",
			note: "Cross-chunk boundary child",
			parentItem: boundaryParentKey,
			tags: [],
		});
		itemKeys.push(boundaryChildKey);
		const boundaryFillerKeys: string[] = [];
		for (let index = 0; index < 49; index += 1) {
			const fillerKey = await createDraft({
				collections: [],
				creators: [],
				itemType: "Report",
				tags: [],
				title: `Cross-chunk filler ${index + 1}`,
			});
			boundaryFillerKeys.push(fillerKey);
			itemKeys.push(fillerKey);
		}
		const boundaryFirstChunk = await runBatch({
			action: "publish",
			keys: [boundaryChildKey, ...boundaryFillerKeys],
		});
		assert(
			boundaryFirstChunk[0]?.outcome === "failed" &&
				boundaryFirstChunk[0].retryable === true &&
				boundaryFirstChunk
					.slice(1)
					.every(({ outcome }) => outcome === "changed"),
			`Cross-chunk dependency was not marked retryable: ${JSON.stringify(boundaryFirstChunk)}`,
		);
		const boundarySecondChunk = await runBatch({
			action: "publish",
			keys: [boundaryParentKey],
		});
		assert(
			boundarySecondChunk[0]?.outcome === "changed",
			`Cross-chunk parent did not publish: ${JSON.stringify(boundarySecondChunk)}`,
		);
		const boundaryRetry = await runBatch({
			action: "publish",
			keys: [boundaryChildKey],
		});
		assert(
			boundaryRetry[0]?.outcome === "changed" &&
				(await getItem(boundaryChildKey)).state === "published",
			`Cross-chunk child retry failed: ${JSON.stringify(boundaryRetry)}`,
		);

		console.log(
			JSON.stringify({
				assigned: assignments.length,
				collectionKey,
				itemKeys,
				published: publications.length,
				publishedParentDivergenceVerified: true,
				removed: removals.length,
				mixedOutcomesVerified: true,
				crossChunkDependencyRetryVerified: true,
			}),
		);
	} finally {
		if (itemKeys.length > 0) {
			await db
				.delete(outbox)
				.where(
					and(
						eq(outbox.entityType, "item"),
						inArray(outbox.entityKey, itemKeys),
					),
				);
			await db
				.delete(itemToCollection)
				.where(inArray(itemToCollection.itemKey, itemKeys));
			await db
				.delete(itemToTag)
				.where(inArray(itemToTag.itemKey, itemKeys));
			await db
				.delete(adminItemListProjection)
				.where(inArray(adminItemListProjection.key, itemKeys));
			await db.delete(item).where(inArray(item.key, itemKeys));
			await db
				.delete(itemDraft)
				.where(inArray(itemDraft.itemKey, itemKeys));
			await db
				.delete(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, "native"),
						inArray(itemIdentity.key, itemKeys),
					),
				);
		}
		if (collectionKey) {
			await db
				.delete(outbox)
				.where(
					and(
						eq(outbox.entityType, "collection"),
						eq(outbox.entityKey, collectionKey),
					),
				);
			await db
				.delete(collection)
				.where(eq(collection.key, collectionKey));
			await db
				.delete(collectionIdentity)
				.where(eq(collectionIdentity.key, collectionKey));
		}
		await database.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
