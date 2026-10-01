import { sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import type { DuplicateRecord } from "./reconciliation";

/** What two records are compared on: their key, normalised DOI, title and publication date. */
export type WorkFacts = {
	key: string;
	doi: string | null;
	title: string | null;
	date: string | null;
	/** Registered with DataCite, which records Zenodo's versions; only pairs of such works are asked about. */
	dataCite: boolean;
};

/** DOIs DataCite records as versions of another DOI, by the version's DOI. */
type VersionsOf = ReadonlyMap<string, ReadonlySet<string>>;

const DATACITE_DOIS = "https://api.datacite.org/dois";
const DATACITE_BATCH = 50;
const DATACITE_TIMEOUT_MS = 20_000;
const REPEATED_PREFIX = /^10\.\d{4,9}\/(?=10\.\d{4,9}\/)/u;
const FIGSHARE_VERSION = /\.v\d+$/u;

/** A DOI as OpenAlex should have written it: no doubled prefix, no trailing punctuation. */
function cleanDoi(doi: string) {
	let clean = doi.toLowerCase().replace(/[.,;:)]+$/u, "");
	while (REPEATED_PREFIX.test(clean)) clean = clean.replace(REPEATED_PREFIX, "");
	return clean;
}

const workNumber = (key: string) => Number(key.replace(/^\D+/u, "")) || Number.POSITIVE_INFINITY;
const sameWork = (work: WorkFacts) => `${work.title?.trim().toLowerCase() ?? ""}|${work.date ?? ""}`;

/**
 * Which of two records with the same title and date to keep, or null when they are not the same upload. A Zenodo
 * upload has a concept DOI and a DOI per version, and figshare adds `.v1` to its own; OpenAlex lists each as a
 * work. The concept or unversioned DOI is kept, since it always leads to the latest version.
 */
function keptOf(a: WorkFacts, b: WorkFacts, versionsOf: VersionsOf): WorkFacts | null {
	const [ca, cb] = [cleanDoi(a.doi!), cleanDoi(b.doi!)];
	if (ca === cb) {
		const aClean = a.doi === ca;
		if (aClean !== (b.doi === cb)) return aClean ? a : b;
		return workNumber(a.key) <= workNumber(b.key) ? a : b;
	}
	if (ca.replace(FIGSHARE_VERSION, "") === cb) return b;
	if (cb.replace(FIGSHARE_VERSION, "") === ca) return a;
	if (versionsOf.get(ca)?.has(cb)) return b;
	if (versionsOf.get(cb)?.has(ca)) return a;
	return null;
}

function* candidatePairs(works: readonly WorkFacts[]) {
	for (const group of Map.groupBy(works.filter((work) => work.doi && work.title), sameWork).values()) {
		for (const [index, work] of group.entries()) for (const other of group.slice(index + 1)) yield [work, other] as const;
	}
}

/** The DOIs DataCite has to say something about before the records' duplicates are known. */
export function uncertainDuplicateDois(works: readonly WorkFacts[]) {
	const dois = new Set<string>();
	for (const [work, other] of candidatePairs(works)) {
		if (!work.dataCite || !other.dataCite || keptOf(work, other, new Map())) continue;
		dois.add(cleanDoi(work.doi!));
		dois.add(cleanDoi(other.doi!));
	}
	return [...dois];
}

/** Each record that repeats another, mapped to the record kept instead. */
export function duplicateWorkKeys(works: readonly WorkFacts[], versionsOf: VersionsOf) {
	const keptFor = new Map<string, string>();
	for (const [work, other] of candidatePairs(works)) {
		const kept = keptOf(work, other, versionsOf);
		if (kept) keptFor.set(kept === work ? other.key : work.key, kept.key);
	}
	// A kept record can itself repeat another, as a Zenodo concept DOI written two ways: follow it to the end.
	for (const [repeat, kept] of keptFor) {
		let final = kept;
		for (let hops = 0; keptFor.has(final) && hops < keptFor.size; hops++) final = keptFor.get(final)!;
		keptFor.set(repeat, final);
	}
	return keptFor;
}

type DataCiteRecord = {
	attributes?: { doi?: string; relatedIdentifiers?: { relationType?: string; relatedIdentifier?: string; relatedIdentifierType?: string }[] };
};

/** The DOIs a DataCite record says it is a version of. */
function versionTargets(record: DataCiteRecord) {
	return (record.attributes?.relatedIdentifiers ?? []).flatMap((relation) =>
		relation.relationType === "IsVersionOf" && relation.relatedIdentifierType === "DOI" && relation.relatedIdentifier
			? [cleanDoi(relation.relatedIdentifier)]
			: [],
	);
}

/** What DataCite records as versions of other DOIs, for the DOIs it has. */
async function dataCiteVersions(dois: readonly string[], fetchImpl: typeof fetch) {
	const versionsOf = new Map<string, Set<string>>();
	for (let start = 0; start < dois.length; start += DATACITE_BATCH) {
		const url = new URL(DATACITE_DOIS);
		url.searchParams.set("ids", dois.slice(start, start + DATACITE_BATCH).join(","));
		url.searchParams.set("page[size]", String(DATACITE_BATCH));
		url.searchParams.set("fields[dois]", "doi,relatedIdentifiers");
		const response = await fetchImpl(url, {
			headers: { Accept: "application/vnd.api+json", "User-Agent": "Evidence-Library/1.0 (mailto:contact@opendeved.net)" },
			signal: AbortSignal.timeout(DATACITE_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`DataCite answered ${response.status}`);
		for (const record of ((await response.json()) as { data?: DataCiteRecord[] }).data ?? []) {
			const targets = versionTargets(record);
			const doi = record.attributes?.doi?.toLowerCase();
			if (doi && targets.length) versionsOf.set(doi, new Set(targets));
		}
	}
	return versionsOf;
}

/**
 * The source's records that repeat another of its records, from a pass over its live records once a scan has
 * written its works. After a full scan only records it read count, so a record kept instead is one the scan keeps.
 * When DataCite cannot be asked, no record is taken for a version it would have confirmed.
 */
export async function findDuplicateRecords(
	database: Database,
	sourceConnectionKey: string,
	readSince: string | null,
	fetchImpl: typeof fetch = fetch,
): Promise<DuplicateRecord[]> {
	const { rows } = await database.execute<WorkFacts & { itemKey: string }>(sql`
		WITH live AS (
			SELECT links."sourceRecordKey" AS key, links."itemKey" AS "itemKey", i."DOI" AS doi, i.title, i.date,
				COALESCE(snapshot.payload -> 'indexed_in' ? 'datacite', false) AS "dataCite",
				md5(lower(trim(i.title))) AS title_hash
			FROM "itemSourceLink" links
			JOIN item i ON i.key = links."itemKey"
			JOIN "sourceSnapshot" snapshot ON snapshot."itemKey" = i.key AND snapshot."sourceConnectionKey" = links."sourceConnectionKey"
			WHERE links."sourceConnectionKey" = ${sourceConnectionKey} AND NOT links."remoteDeleted"
				AND i.deleted = 0 AND i."parentItem" IS NULL AND i."DOI" IS NOT NULL AND i.title IS NOT NULL
				AND (${readSince}::timestamptz IS NULL OR snapshot."fetchedAt" >= ${readSince}::timestamptz)
		)
		SELECT key, "itemKey", doi, title, date, "dataCite" FROM live
		WHERE (title_hash, COALESCE(date, '')) IN (SELECT title_hash, COALESCE(date, '') FROM live GROUP BY 1, 2 HAVING count(*) > 1)
	`);
	if (!rows.length) return [];
	let versionsOf: VersionsOf = new Map();
	const uncertain = uncertainDuplicateDois(rows);
	if (uncertain.length) {
		try {
			versionsOf = await dataCiteVersions(uncertain, fetchImpl);
		} catch (error) {
			console.warn("DataCite could not be asked whether OpenAlex works are versions of each other; keeping them", {
				sourceConnectionKey,
				dois: uncertain.length,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	const itemKeyOf = new Map(rows.map((row) => [row.key, row.itemKey]));
	return [...duplicateWorkKeys(rows, versionsOf)].map(([recordKey, keptKey]) => ({
		recordKey,
		itemKey: itemKeyOf.get(recordKey)!,
		keptItemKey: itemKeyOf.get(keptKey)!,
	}));
}

/** The record keys among these that an earlier pass found to repeat another record of the source. */
export async function skippedDuplicateKeys(database: Database, sourceConnectionKey: string, recordKeys: readonly string[]) {
	if (!recordKeys.length) return new Set<string>();
	const { rows } = await database.execute<{ aliasKey: string }>(sql`
		SELECT "aliasKey" FROM "sourceRecordAlias"
		WHERE "sourceConnectionKey" = ${sourceConnectionKey} AND kind = 'duplicate-of'
			AND "aliasKey" = ANY(ARRAY[${sql.join(recordKeys.map((key) => sql`${key}`), sql`, `)}]::varchar[])
	`);
	return new Set(rows.map((row) => row.aliasKey));
}
