import { and, asc, eq, inArray, notExists, or, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import {
	itemLink,
	type ItemLinkKind,
	MANUAL_ITEM_LINK_ORIGIN,
	SOURCE_ITEM_LINK_ORIGIN_PREFIX,
} from "@/db/schema/tables/itemLink";

type Executor = Database | DatabaseTransaction;

export type ItemLinkRow = typeof itemLink.$inferSelect;

export type PublicItemLinks = {
	cites: string[];
	citedBy: string[];
	related: string[];
};

export function sourceItemLinkOrigin(sourceConnectionKey: string) {
	return `${SOURCE_ITEM_LINK_ORIGIN_PREFIX}${sourceConnectionKey}`;
}

export function isManualItemLinkOrigin(origin: string) {
	return origin === MANUAL_ITEM_LINK_ORIGIN;
}

/** Links that start at `key`, oldest first. */
export async function getOutgoingLinks(
	db: Executor,
	key: string,
	options: { kind?: ItemLinkKind } = {},
): Promise<ItemLinkRow[]> {
	return db
		.select()
		.from(itemLink)
		.where(
			options.kind
				? and(eq(itemLink.fromKey, key), eq(itemLink.kind, options.kind))
				: eq(itemLink.fromKey, key),
		)
		.orderBy(asc(itemLink.createdAt), asc(itemLink.toKey));
}

/** Links that point at `key`, oldest first. */
export async function getIncomingLinks(
	db: Executor,
	key: string,
	options: { kind?: ItemLinkKind } = {},
): Promise<ItemLinkRow[]> {
	return db
		.select()
		.from(itemLink)
		.where(
			options.kind
				? and(eq(itemLink.toKey, key), eq(itemLink.kind, options.kind))
				: eq(itemLink.toKey, key),
		)
		.orderBy(asc(itemLink.createdAt), asc(itemLink.fromKey));
}

/**
 * What the public item page shows. Only records that are published (`deleted = 0`)
 * and not hidden by a configured tag are listed. `related` is the union of both
 * directions without duplicates.
 */
export async function getPublicItemLinks(
	db: Executor,
	key: string,
	options: { hiddenTags?: readonly string[] } = {},
): Promise<PublicItemLinks> {
	const hiddenTags = [...(options.hiddenTags ?? [])];
	const visible = (column: typeof itemLink.toKey | typeof itemLink.fromKey) =>
		hiddenTags.length === 0
			? eq(item.deleted, 0)
			: and(
					eq(item.deleted, 0),
					notExists(
						db
							.select({ one: sql`1` })
							.from(itemToTag)
							.where(
								and(
									eq(itemToTag.itemKey, column),
									inArray(itemToTag.tagName, hiddenTags),
								),
							),
					),
				);
	const outgoing = await db
		.select({ toKey: itemLink.toKey, kind: itemLink.kind })
		.from(itemLink)
		.innerJoin(item, eq(item.key, itemLink.toKey))
		.where(and(eq(itemLink.fromKey, key), visible(itemLink.toKey)))
		.orderBy(asc(itemLink.createdAt), asc(itemLink.toKey));
	const incoming = await db
		.select({ fromKey: itemLink.fromKey, kind: itemLink.kind })
		.from(itemLink)
		.innerJoin(item, eq(item.key, itemLink.fromKey))
		.where(and(eq(itemLink.toKey, key), visible(itemLink.fromKey)))
		.orderBy(asc(itemLink.createdAt), asc(itemLink.fromKey));

	// Several owners may assert the same pair; the public view lists each record once.
	const cites = new Set<string>();
	const citedBy = new Set<string>();
	const related = new Set<string>();
	for (const row of outgoing) {
		if (row.kind === "related") related.add(row.toKey);
		else cites.add(row.toKey);
	}
	for (const row of incoming) {
		if (row.kind === "related") related.add(row.fromKey);
		else citedBy.add(row.fromKey);
	}

	return { cites: [...cites], citedBy: [...citedBy], related: [...related] };
}

/**
 * `getPublicItemLinks` for many records at once (used by the search projection).
 * Lists only published targets; readers that know hidden tags filter further.
 */
export async function getPublicItemLinksForKeys(
	db: Pick<Executor, "select">,
	keys: readonly string[],
): Promise<Map<string, PublicItemLinks>> {
	const result = new Map<string, PublicItemLinks>();
	if (keys.length === 0) return result;
	const rows = await db
		.select({
			fromKey: itemLink.fromKey,
			kind: itemLink.kind,
			toKey: itemLink.toKey,
		})
		.from(itemLink)
		.innerJoin(
			item,
			or(
				and(inArray(itemLink.fromKey, [...keys]), eq(item.key, itemLink.toKey)),
				and(inArray(itemLink.toKey, [...keys]), eq(item.key, itemLink.fromKey)),
			),
		)
		.where(eq(item.deleted, 0))
		.orderBy(asc(itemLink.createdAt), asc(itemLink.fromKey), asc(itemLink.toKey));
	const sets = new Map<
		string,
		{ cites: Set<string>; citedBy: Set<string>; related: Set<string> }
	>();
	const bucket = (key: string) => {
		let entry = sets.get(key);
		if (!entry) {
			entry = { cites: new Set(), citedBy: new Set(), related: new Set() };
			sets.set(key, entry);
		}
		return entry;
	};
	const wanted = new Set(keys);
	for (const row of rows) {
		if (wanted.has(row.fromKey)) {
			const entry = bucket(row.fromKey);
			if (row.kind === "related") entry.related.add(row.toKey);
			else entry.cites.add(row.toKey);
		}
		if (wanted.has(row.toKey)) {
			const entry = bucket(row.toKey);
			if (row.kind === "related") entry.related.add(row.fromKey);
			else entry.citedBy.add(row.fromKey);
		}
	}
	for (const [key, entry] of sets) {
		result.set(key, {
			cites: [...entry.cites],
			citedBy: [...entry.citedBy],
			related: [...entry.related],
		});
	}
	return result;
}

/**
 * Mirrors a source's "related" links for the given records.
 * Deletes that source's `related` rows for `fromKeys`, then inserts `links`.
 * Rows owned by the editor (`manual`) or by another source are never touched.
 * Returns the records on the other end of every row that actually changed, so
 * the caller can reindex them.
 */
export async function replaceSourceRelatedLinks(
	tx: Executor,
	input: {
		sourceConnectionKey: string;
		fromKeys: string[];
		links: { fromKey: string; toKey: string }[];
	},
): Promise<{ changedTargets: string[]; inserted: number; removed: number }> {
	if (input.fromKeys.length === 0) {
		return { changedTargets: [], inserted: 0, removed: 0 };
	}
	const origin = sourceItemLinkOrigin(input.sourceConnectionKey);
	const removedRows = await tx
		.delete(itemLink)
		.where(
			and(
				eq(itemLink.origin, origin),
				eq(itemLink.kind, "related"),
				inArray(itemLink.fromKey, input.fromKeys),
			),
		)
		.returning({ fromKey: itemLink.fromKey, toKey: itemLink.toKey });
	const candidates = uniquePairs(input.links).filter(
		(link) => link.fromKey !== link.toKey,
	);
	if (candidates.length > 0) {
		await tx.insert(itemLink).values(
			candidates.map((link) => ({
				fromKey: link.fromKey,
				toKey: link.toKey,
				kind: "related" as const,
				origin,
			})),
		);
	}
	const pairId = (link: { fromKey: string; toKey: string }) =>
		`${link.fromKey} ${link.toKey}`;
	const before = new Set(removedRows.map(pairId));
	const after = new Set(candidates.map(pairId));
	const changedTargets = new Set<string>();
	for (const row of removedRows) {
		if (!after.has(pairId(row))) changedTargets.add(row.toKey);
	}
	for (const link of candidates) {
		if (!before.has(pairId(link))) changedTargets.add(link.toKey);
	}
	return {
		changedTargets: [...changedTargets].sort((left, right) =>
			left.localeCompare(right),
		),
		inserted: candidates.length,
		removed: removedRows.length,
	};
}

/**
 * Replaces the editor's links of one kind for a record. Only `manual` rows change.
 * `cites` is directed, so only rows starting at `fromKey` are looked at.
 * `related` is one link seen from both sides: rows in either direction count as
 * present, removal deletes the row whichever side stored it, and new links are
 * stored as `fromKey → toKey`. Returns the other-end keys added and removed.
 */
export async function replaceManualLinks(
	tx: Executor,
	input: { fromKey: string; kind: ItemLinkKind; toKeys: string[] },
): Promise<{ added: string[]; removed: string[] }> {
	const wanted = [...new Set(input.toKeys)].filter((key) => key !== input.fromKey);
	const symmetric = input.kind === "related";
	const ownRows = and(
		eq(itemLink.kind, input.kind),
		eq(itemLink.origin, MANUAL_ITEM_LINK_ORIGIN),
		symmetric
			? or(eq(itemLink.fromKey, input.fromKey), eq(itemLink.toKey, input.fromKey))
			: eq(itemLink.fromKey, input.fromKey),
	);
	const current = await tx
		.select({ fromKey: itemLink.fromKey, toKey: itemLink.toKey })
		.from(itemLink)
		.where(ownRows);
	const otherEnd = (row: { fromKey: string; toKey: string }) =>
		row.fromKey === input.fromKey ? row.toKey : row.fromKey;
	const currentKeys = new Set(current.map(otherEnd));
	const added = wanted.filter((key) => !currentKeys.has(key));
	const removed = [...currentKeys].filter((key) => !wanted.includes(key));
	if (removed.length > 0) {
		await tx
			.delete(itemLink)
			.where(
				and(
					ownRows,
					symmetric
						? or(inArray(itemLink.toKey, removed), inArray(itemLink.fromKey, removed))
						: inArray(itemLink.toKey, removed),
				),
			);
	}
	if (added.length > 0) {
		await tx.insert(itemLink).values(
			added.map((toKey) => ({
				fromKey: input.fromKey,
				toKey,
				kind: input.kind,
				origin: MANUAL_ITEM_LINK_ORIGIN,
			})),
		);
	}
	return { added, removed };
}

/**
 * `manual` link keys per kind, as stored in the record draft payload:
 * outgoing `cites`, and `related` in both directions (one link, two sides).
 */
export async function getManualLinkKeys(
	db: Executor,
	fromKey: string,
): Promise<{ cites: string[]; related: string[] }> {
	const rows = await db
		.select({ fromKey: itemLink.fromKey, toKey: itemLink.toKey, kind: itemLink.kind })
		.from(itemLink)
		.where(
			and(
				eq(itemLink.origin, MANUAL_ITEM_LINK_ORIGIN),
				or(
					eq(itemLink.fromKey, fromKey),
					and(eq(itemLink.toKey, fromKey), eq(itemLink.kind, "related")),
				),
			),
		)
		.orderBy(asc(itemLink.createdAt), asc(itemLink.toKey), asc(itemLink.fromKey));
	const related = new Set<string>();
	for (const row of rows) {
		if (row.kind !== "related") continue;
		related.add(row.fromKey === fromKey ? row.toKey : row.fromKey);
	}
	return {
		cites: rows.filter((row) => row.kind === "cites").map((row) => row.toKey),
		related: [...related],
	};
}

/** Keys from `keys` that exist in the item table (published or unpublished). */
export async function existingItemKeys(
	db: Executor,
	keys: string[],
): Promise<Set<string>> {
	if (keys.length === 0) return new Set();
	const rows = await db
		.select({ key: item.key })
		.from(item)
		.where(inArray(item.key, keys));
	return new Set(rows.map((row) => row.key));
}

function uniquePairs(links: { fromKey: string; toKey: string }[]) {
	const seen = new Set<string>();
	return links.filter((link) => {
		const id = `${link.fromKey} ${link.toKey}`;
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
}

/**
 * Deletes source-owned `related` rows between `itemKey` and `targetKeys` in both
 * directions for the given sources. Used when the editor removes a manual related
 * link: the record is about to tell those sources to drop the pair, and Zotero
 * clears its mirror without bumping the other item's version, so the mirrored rows
 * would otherwise linger. The next sync restores them if a source still has the pair.
 */
export async function removeMirroredSourceRelatedLinks(
	tx: Executor,
	input: { itemKey: string; sourceConnectionKeys: string[]; targetKeys: string[] },
): Promise<number> {
	if (input.targetKeys.length === 0 || input.sourceConnectionKeys.length === 0) {
		return 0;
	}
	const origins = input.sourceConnectionKeys.map(sourceItemLinkOrigin);
	const removed = await tx
		.delete(itemLink)
		.where(
			and(
				eq(itemLink.kind, "related"),
				inArray(itemLink.origin, origins),
				or(
					and(
						eq(itemLink.toKey, input.itemKey),
						inArray(itemLink.fromKey, input.targetKeys),
					),
					and(
						eq(itemLink.fromKey, input.itemKey),
						inArray(itemLink.toKey, input.targetKeys),
					),
				),
			),
		)
		.returning({ fromKey: itemLink.fromKey });
	return removed.length;
}
