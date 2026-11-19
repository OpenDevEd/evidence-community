import "server-only";

import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { utcDay } from "@/lib/licences";
import { enqueueItemSearchReprojections } from "@/lib/publication/queue";
import type { EvidenceFileStorage } from "./file-storage";
import { placeRecordFiles } from "./withdrawn-files";

/**
 * Each night, puts the files of every record with a licence of its own (the only ones whose files can be kept from
 * readers) where who may get them says: a move that failed is finished, and an embargo that ended brings its files
 * into public view; the record's page shows them from that day already (`filesHiddenFor`). Records whose embargo has
 * ended go into search again, which counted them as no PDF. Zenodo lifts its own embargo.
 */
export async function settleRecordFiles(db: Database, storage: EvidenceFileStorage, now = new Date()) {
	const today = utcDay(now);
	const licensed = await db.select({ key: item.key }).from(item).where(and(eq(item.deleted, 0), isNotNull(item.licence)));
	await placeRecordFiles(db, storage, licensed.map(({ key }) => key), today);
	// ponytail: every ended embargo is indexed again each night, as nothing records which were; fine while embargoes are
	// few, mark them done if they grow to many.
	const ended = await db
		.select({ key: item.key, revision: item.revision })
		.from(item)
		.where(and(eq(item.deleted, 0), sql`${item.fileAccess}->>'mode' = 'embargo'`, lte(sql<string>`${item.fileAccess}->>'until'`, today)));
	if (ended.length) await db.transaction((transaction) => enqueueItemSearchReprojections(transaction, ended.map(({ key, revision }) => ({ itemKey: key, revision })), now));
	return ended.length;
}
