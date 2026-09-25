import { collectionIdentity, itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, sql } from "drizzle-orm";

import type { DatabaseTransaction } from "@/db/database-schema";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemLink } from "@/db/schema/tables/itemLink";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { chunkValues } from "@/lib/chunk-values";
import { sourceItemLinkOrigin } from "@/lib/links/item-links";

/*
 * Zotero has no citation field. OpenDevEd's libraries record citations two ways, set up by the Kerko-era tools and
 * zotero-lib's `enclose_item_in_collection`, and read the same way by the previous library's sync:
 * - a note tagged `_cites` under a publication: every Zotero item link in it is a publication it cites;
 * - a `✅_References` collection: every record in its parent collection cites every record in it.
 */
const CITES_NOTE_TAG = "_cites";
const REFERENCES_COLLECTION_NAME = "✅_References";

const ZOTERO_ITEM_URI =
	/(?:https?:\/\/(?:www\.)?zotero\.org\/|zotero:\/\/select\/)(?:library|(?:groups|users)\/[0-9]+)\/items\/([A-Z0-9]+)/g;

type Pair = { fromKey: string; toKey: string };

/** The Zotero item keys a `_cites` note links to. */
function citedZoteroKeys(note: string | null) {
	return [...new Set([...(note ?? "").matchAll(ZOTERO_ITEM_URI)].map((match) => match[1]!))];
}

/**
 * The citations the two conventions describe, as library keys. Only publications still in the library count at
 * either end, and a record never cites itself.
 */
function zoteroCitationPairs(input: {
	/** Library key of each publication this source holds, by its Zotero key. */
	keyByZoteroKey: ReadonlyMap<string, string>;
	/** Publications (not notes or attachments) this source holds that are not deleted. */
	publications: ReadonlySet<string>;
	notes: { parentKey: string; note: string | null }[];
	references: { citing: string[]; cited: string[] }[];
}): Pair[] {
	const pairs = new Map<string, Pair>();
	const add = (fromKey: string, toKey: string | undefined) => {
		if (!toKey || fromKey === toKey) return;
		if (!input.publications.has(fromKey) || !input.publications.has(toKey)) return;
		pairs.set(`${fromKey}\u0000${toKey}`, { fromKey, toKey });
	};
	for (const { parentKey, note } of input.notes) {
		for (const zoteroKey of citedZoteroKeys(note)) add(parentKey, input.keyByZoteroKey.get(zoteroKey));
	}
	for (const { citing, cited } of input.references) {
		for (const fromKey of citing) for (const toKey of cited) add(fromKey, toKey);
	}
	return [...pairs.values()];
}

/**
 * Brings this source's citation links in line with its stored notes and collections. It reads the whole library, not
 * the batch: a citation changes when a note or a folder changes, not the publication that cites. Only rows that changed
 * are written, so the rest keep their dates. Returns every record whose citations changed, to be reindexed.
 * ponytail: rereads the source's notes and folders on every batch; cheap at thousands of records, move to the last
 * batch of a sync if a library grows far past that.
 */
export async function replaceZoteroCitationLinks(tx: DatabaseTransaction, sourceConnectionKey: string) {
	const origin = sourceItemLinkOrigin(sourceConnectionKey);
	const fromThisSource = and(
		eq(itemSourceLink.itemKey, item.key),
		eq(itemSourceLink.sourceConnectionKey, sourceConnectionKey),
	);
	const [records, notes, referenceMembers, existing] = await Promise.all([
		tx
			.select({ key: item.key, zoteroKey: itemSourceLink.sourceRecordKey, parentItem: item.parentItem, deleted: item.deleted })
			.from(item)
			.innerJoin(itemSourceLink, fromThisSource),
		tx
			.select({ parentKey: item.parentItem, note: item.note })
			.from(item)
			.innerJoin(itemSourceLink, fromThisSource)
			.innerJoin(itemToTag, and(eq(itemToTag.itemKey, item.key), eq(itemToTag.tagName, CITES_NOTE_TAG)))
			.where(and(eq(item.itemType, "Note"), eq(item.deleted, 0))),
		// Each `✅_References` folder with the records in it and in its parent.
		tx
			.select({ references: collection.key, member: itemToCollection.itemKey, memberOf: itemToCollection.collectionKey })
			.from(collection)
			.innerJoin(
				collectionIdentity,
				and(eq(collectionIdentity.key, collection.key), eq(collectionIdentity.sourceConnectionKey, sourceConnectionKey)),
			)
			.innerJoin(
				itemToCollection,
				sql`${itemToCollection.collectionKey} in (${collection.key}, ${collection.parentCollection})`,
			)
			.where(and(eq(collection.name, REFERENCES_COLLECTION_NAME), sql`coalesce(${collection.deleted}, 0) = 0`)),
		tx
			.select({ fromKey: itemLink.fromKey, toKey: itemLink.toKey })
			.from(itemLink)
			.where(and(eq(itemLink.origin, origin), eq(itemLink.kind, "cites"))),
	]);

	const byFolder = new Map<string, { citing: string[]; cited: string[] }>();
	for (const row of referenceMembers) {
		const folder = byFolder.get(row.references) ?? { citing: [], cited: [] };
		(row.memberOf === row.references ? folder.cited : folder.citing).push(row.member);
		byFolder.set(row.references, folder);
	}
	const wanted = zoteroCitationPairs({
		keyByZoteroKey: new Map(records.map((record) => [record.zoteroKey, record.key])),
		publications: new Set(records.filter((record) => !record.deleted && !record.parentItem).map((record) => record.key)),
		notes: notes.flatMap((note) => (note.parentKey ? [{ parentKey: note.parentKey, note: note.note }] : [])),
		references: [...byFolder.values()],
	});

	const id = (pair: Pair) => `${pair.fromKey}\u0000${pair.toKey}`;
	const wantedIds = new Set(wanted.map(id));
	const existingIds = new Set(existing.map(id));
	const removed = existing.filter((pair) => !wantedIds.has(id(pair)));
	const added = wanted.filter((pair) => !existingIds.has(id(pair)));
	for (const chunk of chunkValues(removed, 1_000)) {
		await tx
			.delete(itemLink)
			.where(
				and(
					eq(itemLink.origin, origin),
					eq(itemLink.kind, "cites"),
					sql`(${itemLink.fromKey}, ${itemLink.toKey}) in (${sql.join(
						chunk.map((pair) => sql`(${pair.fromKey}, ${pair.toKey})`),
						sql`, `,
					)})`,
				),
			);
	}
	for (const chunk of chunkValues(added, 1_000)) {
		await tx.insert(itemLink).values(chunk.map((pair) => ({ ...pair, kind: "cites" as const, origin })));
	}
	const changedItemKeys = new Set([...removed, ...added].flatMap((pair) => [pair.fromKey, pair.toKey]));
	return { changedItemKeys: [...changedItemKeys].sort() };
}
