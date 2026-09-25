import { collectionIdentity, itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, like, sql } from "drizzle-orm";

import type { DatabaseTransaction } from "@/db/database-schema";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemLink } from "@/db/schema/tables/itemLink";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";
import { chunkValues } from "@/lib/chunk-values";
import { sourceItemLinkOrigin } from "@/lib/links/item-links";

/*
 * Zotero has no citation field. OpenDevEd's libraries record citations two ways, set up by the Kerko-era tools and
 * zotero-lib's `enclose_item_in_collection`, and read the same way by the previous library's sync:
 * - a note tagged `_cites` under a publication: every Zotero item link in it is a publication it cites;
 * - a `✅_References` collection: every record in its parent collection cites every record in it.
 * A note may link a record in another Zotero library. It counts when a record here says it is that record too, in
 * its Extra field: `KerkoCite.ItemAlsoKnownAs: 2129771:ABCD2345 2405685:EFGH6789`.
 */
const CITES_NOTE_TAG = "_cites";
const REFERENCES_COLLECTION_NAME = "✅_References";
const ALSO_KNOWN_AS = "KerkoCite.ItemAlsoKnownAs";

const ZOTERO_ITEM_URI =
	/(?:https?:\/\/(?:www\.)?zotero\.org\/|zotero:\/\/select\/)(?:(groups|users)\/([0-9]+)|library)\/items\/([A-Z0-9]{8})/g;

/**
 * The records a `_cites` note links to, as `<library>/<key>`: `groups/2129771/ABCD2345`. `zotero://select/library/…`
 * names the personal library of whoever opens it, which is this source only when this source is a personal library.
 */
function citedZoteroRecords(note: string | null, personalLibrary: string | null) {
	return [
		...new Set(
			[...(note ?? "").matchAll(ZOTERO_ITEM_URI)].flatMap(([, scope, id, key]) =>
				scope ? [`${scope}/${id}/${key}`] : personalLibrary ? [`${personalLibrary}/${key}`] : [],
			),
		),
	];
}

/** The records in other group libraries a record says it also is, as `groups/<id>/<key>`. */
function alsoKnownAs(extra: string | null) {
	const line = extra?.split("\n").find((entry) => entry.startsWith(`${ALSO_KNOWN_AS}:`));
	return (line?.slice(ALSO_KNOWN_AS.length + 1).trim().split(/\s+/) ?? []).flatMap((value) => {
		const match = /^([0-9]+):([A-Z0-9]{8})$/.exec(value);
		return match ? [`groups/${match[1]}/${match[2]}`] : [];
	});
}

type Pair = { fromKey: string; toKey: string };

/**
 * The citations the two conventions describe, as library keys. Only publications still in the library count at
 * either end, and a record never cites itself.
 */
function zoteroCitationPairs(input: {
	/** Library key of each record, by `groups/<id>/<key>` or `users/<id>/<key>`. */
	keyByZoteroRecord: ReadonlyMap<string, string>;
	/** `users/<id>` when this source is a personal library. */
	personalLibrary: string | null;
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
		for (const record of citedZoteroRecords(note, input.personalLibrary)) add(parentKey, input.keyByZoteroRecord.get(record));
	}
	for (const { citing, cited } of input.references) {
		for (const fromKey of citing) for (const toKey of cited) add(fromKey, toKey);
	}
	return [...pairs.values()];
}

/**
 * Brings this source's citation links in line with its stored notes and collections. It reads the whole library, not
 * the last batch: a citation changes when a note or a folder changes, not the publication that cites. Run it once a
 * sync has written all its batches. Only rows that changed are written, so the rest keep their dates. Returns every
 * record whose citations changed, to be reindexed.
 * ponytail: rereads the source's notes and folders on every sync, changed or not; skip syncs that wrote nothing if
 * libraries grow far past tens of thousands of records.
 */
export async function replaceZoteroCitationLinks(
	tx: DatabaseTransaction,
	connection: { key: string; scopeKind: string; externalScopeKey: string | null },
) {
	const origin = sourceItemLinkOrigin(connection.key);
	// Records the source still has: a record it deleted may live on here when an editor linked it to their own.
	const fromThisSource = and(
		eq(itemSourceLink.itemKey, item.key),
		eq(itemSourceLink.sourceConnectionKey, connection.key),
		eq(itemSourceLink.remoteDeleted, false),
	);
	const [records, aliases, notes, referenceMembers, existing] = await Promise.all([
		tx
			.select({ key: item.key, zoteroKey: itemSourceLink.sourceRecordKey, parentItem: item.parentItem, deleted: item.deleted, itemType: item.itemType })
			.from(item)
			.innerJoin(itemSourceLink, fromThisSource),
		tx
			.select({ key: item.key, extra: item.extra })
			.from(item)
			.innerJoin(itemSourceLink, fromThisSource)
			.where(like(item.extra, `%${ALSO_KNOWN_AS}:%`)),
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
				and(eq(collectionIdentity.key, collection.key), eq(collectionIdentity.sourceConnectionKey, connection.key)),
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
	// This library's own records by their address, then the other libraries' records they say they also are.
	const library = `${connection.scopeKind === "group" ? "groups" : "users"}/${connection.externalScopeKey}`;
	const keyByZoteroRecord = new Map(records.map((record) => [`${library}/${record.zoteroKey}`, record.key]));
	for (const { key, extra } of aliases) {
		for (const record of alsoKnownAs(extra)) if (!keyByZoteroRecord.has(record)) keyByZoteroRecord.set(record, key);
	}
	const wanted = zoteroCitationPairs({
		keyByZoteroRecord,
		personalLibrary: connection.scopeKind === "group" ? null : library,
		publications: new Set(
			records
				.filter((record) => !record.deleted && !record.parentItem && !EXCLUDED_ITEM_TYPES.includes(record.itemType))
				.map((record) => record.key),
		),
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
