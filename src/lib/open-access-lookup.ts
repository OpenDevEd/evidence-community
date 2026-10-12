import { setTimeout as delay } from "node:timers/promises";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemOpenAccessLookup } from "@/db/schema/tables/itemOpenAccessLookup";
import { chunkValues } from "@/lib/chunk-values";
import { enqueueItemSearchReprojections } from "@/lib/publication/queue";
import { hasCurrentOpenAlexWork } from "@/lib/search-index/open-access";
import { readPublicItems } from "@/lib/search-index/projection";
import {
	OPENALEX_MAX_IDS_PER_FILTER,
	OpenAlexClient,
} from "@/lib/source-ingestion/openalex/client";

/** A DOI is asked about again after this long, since an embargo can end. */
const RECHECK_MS = 30 * 24 * 60 * 60_000;
/** Records one round looks at, `OPENALEX_MAX_IDS_PER_FILTER` at a time. */
const ROUND_SIZE = 1_000;
/** The wait once no record is due. */
const IDLE_MS = 60 * 60_000;
const RETRY_MS = 10 * 60_000;
// OpenAlex's doi filter splits on `|` and `,`, and 100 DOIs this long stay under its 16,384 characters.
const MAX_DOI_LENGTH = 150;

type DueRecord = {
	key: string;
	revision: number;
	/** What the last look found: the DOI the record showed, OpenAlex's answer for it, and when. */
	askedDoi: string | null;
	answer: boolean | null;
	checkedAt: Date | null;
};

/**
 * Records with no current OpenAlex work and no editor's choice that were never looked at, changed since, got a DOI from
 * the library's own deposit since (which takes no new revision), or were asked about long ago.
 */
async function dueRecords(database: Database, recheckBefore: Date) {
	const { rows } = await database.execute<DueRecord>(sql`
		SELECT i.key, i.revision::int AS revision, l.doi AS "askedDoi", l."isOpenAccess" AS answer, l."checkedAt" AS "checkedAt"
		FROM item i
		LEFT JOIN "itemOpenAccessLookup" l ON l."itemKey" = i.key
		WHERE i.deleted = 0 AND i."parentItem" IS NULL AND i."openAccess" IS NULL
			AND NOT ${hasCurrentOpenAlexWork(sql`i.key`)}
			AND (l."itemKey" IS NULL OR l."itemRevision" <> i.revision OR l."checkedAt" < ${recheckBefore}
				OR EXISTS (SELECT 1 FROM "publicationIdentifier" p WHERE p."itemKey" = i.key AND p."updatedAt" > l."lookedAt"))
		ORDER BY l."checkedAt" NULLS FIRST, i.key
		LIMIT ${ROUND_SIZE}`);
	return rows.map((row) => ({ ...row, checkedAt: row.checkedAt && new Date(row.checkedAt) }));
}

/** The DOI as OpenAlex's filter can carry it, or null. */
const askable = (doi: string | null) => (doi && doi.length <= MAX_DOI_LENGTH && !/[|,]/u.test(doi) ? doi : null);

/** Asks OpenAlex about one round of records due a look, and returns how many it looked at. */
export async function lookUpOpenAccess({
	database,
	client,
	config,
	now = new Date(),
}: {
	database: Database;
	client: OpenAlexClient;
	config: LibraryServerConfig;
	now?: Date;
}) {
	const recheckBefore = new Date(now.getTime() - RECHECK_MS);
	const due = await dueRecords(database, recheckBefore);
	const counts = { records: due.length, requests: 0, open: 0, closed: 0, changed: 0 };
	for (const part of chunkValues(due, OPENALEX_MAX_IDS_PER_FILTER)) {
		// The DOI a reader sees, which can come from Extra, a DOI attachment or the library's own deposit.
		const shown = new Map(
			(await readPublicItems(database, part.map(({ key }) => key), config)).map((record) => [record.key, record.DOI ?? null]),
		);
		const looks = part.map((record) => {
			const doi = shown.get(record.key) ?? null;
			// A record that changed but still shows the DOI answered lately keeps that answer.
			const fresh = record.askedDoi === doi && record.checkedAt !== null && record.checkedAt >= recheckBefore;
			return { record, doi, fresh, ask: fresh ? null : askable(doi) };
		});
		const dois = [...new Set(looks.flatMap(({ ask }) => (ask ? [ask] : [])))];
		const answers = dois.length > 0 ? await client.openAccessByDoi(dois) : new Map<string, boolean>();
		counts.requests += dois.length > 0 ? 1 : 0;
		const rows = looks.map(({ record, doi, fresh, ask }) => ({
			itemKey: record.key,
			itemRevision: record.revision,
			doi,
			isOpenAccess: fresh ? record.answer : ask ? (answers.get(ask) ?? null) : null,
			checkedAt: fresh ? record.checkedAt! : now,
			lookedAt: now,
		}));
		// The search entry shows the last answer for the DOI the record shows; only a different one is indexed again.
		const changed = rows.flatMap((row, index) => {
			const before = part[index]!;
			return row.isOpenAccess !== (before.askedDoi === row.doi ? before.answer : null) ? [row.itemKey] : [];
		});
		await database.transaction(async (transaction) => {
			await transaction
				.insert(itemOpenAccessLookup)
				.values(rows)
				.onConflictDoUpdate({
					target: itemOpenAccessLookup.itemKey,
					set: {
						itemRevision: sql.raw(`excluded."itemRevision"`),
						doi: sql.raw(`excluded."doi"`),
						isOpenAccess: sql.raw(`excluded."isOpenAccess"`),
						checkedAt: sql.raw(`excluded."checkedAt"`),
						lookedAt: sql.raw(`excluded."lookedAt"`),
					},
				});
			if (changed.length === 0) return;
			const current = await transaction
				.select({ itemKey: item.key, revision: item.revision })
				.from(item)
				.where(and(inArray(item.key, changed), eq(item.deleted, 0)));
			await enqueueItemSearchReprojections(transaction, current, now);
		});
		counts.open += rows.filter((row) => row.isOpenAccess === true).length;
		counts.closed += rows.filter((row) => row.isOpenAccess === false).length;
		counts.changed += changed.length;
	}
	if (counts.requests > 0 || counts.changed > 0) console.log("Open access looked up", counts);
	return due.length;
}

/**
 * Keeps the open access of records from other sources current while the source worker watches, until `signal`
 * aborts. Stopping also ends a request that is waiting out an OpenAlex outage.
 */
export async function runOpenAccessLookups(options: {
	database: Database;
	config: LibraryServerConfig;
	apiKey: string;
	onError: (error: unknown) => void;
	signal: AbortSignal;
}) {
	const { signal } = options;
	const client = new OpenAlexClient({
		apiKey: options.apiKey,
		fetch: (input, init) =>
			fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),
		sleep: (milliseconds) => delay(milliseconds, undefined, { signal }),
	});
	while (!signal.aborted) {
		let wait = IDLE_MS;
		try {
			// A full round leaves more records due.
			if ((await lookUpOpenAccess({ database: options.database, client, config: options.config })) === ROUND_SIZE) wait = 0;
		} catch (error) {
			if (signal.aborted) break;
			options.onError(error);
			wait = RETRY_MS;
		}
		await delay(wait, undefined, { signal }).catch(() => undefined);
	}
}
