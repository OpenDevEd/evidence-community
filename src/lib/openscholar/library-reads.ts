import "server-only";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { LIBRARY_EXPORT_RECORD_CAP } from "@/config/library-config/exports";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { buildPublicLibraryKeysQuery, readPublicLibraryStatus } from "@/lib/library-export-records";
import { LibraryExportError } from "@/lib/library-export-request";
import { readSearchKeys } from "@/lib/library-export-selection";
import { publicParentVisibility } from "@/lib/public-item-visibility";
import { readCollectionFor, readerIdOfClerkUser, readReaderListKeys } from "@/lib/readers/data";
import { publicFields, publicRecordFilters, searchRecords } from "@/lib/search";
import { fieldIn } from "@/lib/search-engine";
import { getCachedCollections } from "@/app/api/cache";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { loadSearchParams } from "@/lib/searchParams";
import { filterPublicAttachments } from "@/lib/attachment-visibility";
import { publicTagRules } from "@/lib/tags";
import { normalizeDoi } from "@/lib/doi";
import { openAlexItemKeys } from "@/lib/source-ingestion/openalex/references";
import { toOpenScholarRecord, type OpenScholarRecord } from "./records";

/**
 * What OpenScholar reads of a library as one of its people (plans/evidence-library-sources in OpenScholar): their
 * collections, a source turned into record keys, and records by key. Every call carries the library's machine
 * credential, the contract version in `OpenScholar-Contract`, and, when it is about a person, their Clerk user ID; the
 * library's own checks decide what that person may read.
 */
const OPENSCHOLAR_CONTRACT = "1";
/** Most keys a source gives at once: as many as a complete export holds. */
const RESOLVE_MAX_KEYS = LIBRARY_EXPORT_RECORD_CAP;
/** Most records one batch reads, and the bytes they may come to. */
const BATCH_MAX_KEYS = 500;
const BATCH_MAX_BYTES = 4 * 1024 * 1024;

export type Refusal = { error: string; message: string; status: number };
const refusal = (error: string, message: string, status: number): Refusal => ({ error, message, status });

export const refusals = {
	contract: refusal("contract", `This community speaks contract ${OPENSCHOLAR_CONTRACT}: send it in OpenScholar-Contract.`, 400),
	invalid: (message: string) => refusal("invalid_request", message, 400),
	notFound: refusal("not_found", "There is no such collection.", 404),
	private: refusal("private", "This collection is private.", 403),
	readerAccountsOff: refusal("reader_accounts_off", "This community has no reader accounts.", 403),
	tooMany: refusal("too_many", `A source gives at most ${RESOLVE_MAX_KEYS.toLocaleString("en")} records at once.`, 413),
	indexChanged: refusal("index_changed", "The community's search changed while it was read. Ask again.", 409),
	notReader: refusal("not_reader", "This person has never signed in to this community.", 404),
	role: refusal("role", "Only the collection's owner and its editors can change it.", 403),
	owner: refusal("role", "Only the collection's owner can delete it.", 403),
	changed: (message: string) => refusal("changed", message, 409),
} as const;

/**
 * Answers one OpenScholar call: the credential and the contract are checked on one configuration revision, which
 * `run` reads too. A refusal and a failure are logged with the library, the call and the reader.
 */
export async function answerOpenScholar(
	request: Request,
	call: string,
	run: (input: { config: LibraryServerConfig; database: Database }) => Promise<{ body: unknown; status?: number } | Refusal>,
) {
	await connection();
	const config = await getLibraryConfig();
	const libraryId = config.authentication.openScholar.libraryId;
	const denied = await requireOpenScholarBearer(request, config.authentication.openScholar.machineCredential);
	if (denied) {
		console.warn("[library sources] refused", { libraryId, call, reader: await readerOfRequest(request, null), error: "credential", status: denied.status });
		return denied;
	}
	// A body is read for its reader only once the credential holds, and only for a log line.
	const copy = request.method === "POST" ? request.clone() : null;
	const answer = request.headers.get("openscholar-contract") === OPENSCHOLAR_CONTRACT
		? await run({ config, database: await getDatabaseForConfig(config) }).catch((error: unknown) => error)
		: refusals.contract;
	if (answer && typeof answer === "object" && "body" in answer) {
		return NextResponse.json(answer.body, { status: "status" in answer && typeof answer.status === "number" ? answer.status : 200, headers: { ...ADMIN_RESPONSE_HEADERS, "OpenScholar-Contract": OPENSCHOLAR_CONTRACT } });
	}
	if (answer && typeof answer === "object" && "error" in answer && "status" in answer && typeof answer.status === "number") {
		const { error, message, status } = answer as Refusal;
		console.warn("[library sources] refused", { libraryId, call, reader: await readerOfRequest(request, copy), error, message });
		return NextResponse.json({ error, message }, { status, headers: { ...ADMIN_RESPONSE_HEADERS, "OpenScholar-Contract": OPENSCHOLAR_CONTRACT } });
	}
	console.error("[library sources] failed", { libraryId, call, reader: await readerOfRequest(request, copy), error: String(answer) });
	return adminErrorResponse(answer);
}

/** The Clerk user a call names, for its log lines: in its address, or in `body`, a copy of its body. */
async function readerOfRequest(request: Request, body: Request | null): Promise<string | null> {
	const url = new URL(request.url);
	const named = url.searchParams.get("reader") ?? url.pathname.match(/\/readers\/([^/]+)\//)?.[1];
	if (named) return named.slice(0, 512);
	const json: unknown = body ? await body.json().catch(() => null) : null;
	return json && typeof json === "object" && "reader" in json && typeof json.reader === "string" ? json.reader.slice(0, 512) : null;
}

/** The person a call is about: their reader here, or null for someone who never signed in to this library. */
export async function readerFor(config: LibraryServerConfig, database: Database, clerkUserId: string | null | undefined) {
	if (!clerkUserId) return null;
	if (!config.features.readerAccounts) return null;
	return await readerIdOfClerkUser(database, clerkUserId);
}

/**
 * A change OpenScholar asks for on one of a person's collections here: the request's body read with `schema`, and who
 * the person is here. A refusal when the library keeps no reader accounts, the body doesn't fit or the person never
 * signed in.
 */
export async function readerCollectionChange<Body>(request: Request, params: Promise<{ clerkUserId: string; id: string }>, config: LibraryServerConfig, database: Database, schema: z.ZodType<Body>) {
	if (!config.features.readerAccounts) return { refused: refusals.readerAccountsOff };
	// No body reads as {}; a body that isn't JSON is refused, never read as no conditions.
	const text = await request.text();
	let sent: unknown = {};
	try {
		if (text) sent = JSON.parse(text);
	} catch {
		return { refused: refusals.invalid("The request body isn't JSON.") };
	}
	const body = schema.safeParse(sent);
	if (!body.success) return { refused: refusals.invalid(fromError(body.error).toString()) };
	const { clerkUserId, id } = await params;
	const readerId = await readerFor(config, database, clerkUserId);
	if (!readerId) return { refused: refusals.notReader };
	return { body: body.data, clerkUserId, id, readerId };
}

const sourceSchema = z.union([
	z.object({ readerCollection: z.string().min(1).max(64) }).strict(),
	z.object({ libraryCollection: z.string().min(1).max(64) }).strict(),
	z.object({ library: z.literal(true) }).strict(),
	/** The query string of the library's search page, as its address holds it, inside a reader collection or not. */
	z.object({ search: z.string().max(8000), readerCollection: z.string().min(1).max(64).optional() }).strict(),
	z.object({ records: z.array(z.string().min(1).max(64)).min(1).max(RESOLVE_MAX_KEYS) }).strict(),
]);
export type LibrarySource = z.infer<typeof sourceSchema>;

export const resolveRequestSchema = z
	.object({ reader: z.string().max(512).nullable().default(null), source: sourceSchema, first: z.number().int().min(1).default(1), last: z.number().int().min(1).optional() })
	.strict();

/** The keys a reader collection allows, for a search inside it, once its viewer may read it. */
async function collectionKeys(config: LibraryServerConfig, database: Database, collectionId: string, readerId: string | null) {
	if (!config.features.readerAccounts) return refusals.readerAccountsOff;
	const found = await readCollectionFor(database, collectionId, readerId);
	if ("refused" in found) return found.refused === 403 ? refusals.private : refusals.notFound;
	const read = await readReaderListKeys(database, { userId: found.collection.ownerId, collectionId }, readerId);
	if ("refused" in read) return read.refused === 403 ? refusals.private : refusals.notFound;
	return { ownerId: found.collection.ownerId, keys: read.keys };
}

/** A search page's query string as the search it makes, inside a reader collection when one is given. */
function searchContext(query: string, readerList: { userId: string; collectionId: string } | null) {
	const params = loadSearchParams(new URLSearchParams(query.replace(/^\?/, "")));
	return normalizeLibrarySearchContext({ ...params, readerList });
}

type Resolved = { keys: string[]; total: number; truncated: boolean } | Refusal;
type Range = { first: number; until: number };

/** The whole library in key order. */
async function resolveLibrary(config: LibraryServerConfig, database: Database, { first, until }: Range): Promise<Resolved> {
	const [keys, status] = await Promise.all([buildPublicLibraryKeysQuery(database, config, until - first + 1, first - 1), readPublicLibraryStatus(database, config)]);
	return { keys: keys.map((row) => row.key), total: Number(status?.totalItems ?? 0), truncated: false };
}

/** The keys given that name a public record now, each once, in the order given: what the database says, which the search index follows a moment later. */
export async function publicKeys(config: LibraryServerConfig, database: Pick<Database, "select">, keys: string[], { lock = false } = {}) {
	const unique = [...new Set(keys)];
	const query = database.select({ key: item.key }).from(item).where(and(publicParentVisibility(database, config.content.tags.hidden), inArray(item.key, unique)));
	// Locked, a record read as public can't be deleted before the caller's transaction ends.
	const rows = await (lock ? query.for("share", { of: item }) : query);
	const live = new Set(rows.map((row) => row.key));
	return unique.filter((key) => live.has(key));
}

/** A list of records as given, without the ones that aren't public. */
async function resolveRecords(config: LibraryServerConfig, database: Database, records: string[], { first, until }: Range): Promise<Resolved> {
	const keys = await publicKeys(config, database, records);
	return { keys: keys.slice(first - 1, until), total: keys.length, truncated: false };
}

/** A search, a reader collection or one of the library's collections, as the library lists it. */
async function resolveSearch(config: LibraryServerConfig, database: Database, readerId: string | null, source: Exclude<LibrarySource, { library: true } | { records: string[] }>, { first, until }: Range, signal: AbortSignal): Promise<Resolved> {
	let allowed: string[] | undefined;
	let readerList: { userId: string; collectionId: string } | null = null;
	if ("readerCollection" in source && source.readerCollection) {
		const read = await collectionKeys(config, database, source.readerCollection, readerId);
		if ("error" in read) return read;
		allowed = read.keys;
		readerList = { userId: read.ownerId, collectionId: source.readerCollection };
	}
	const context = "search" in source
		? searchContext(source.search, readerList)
		: normalizeLibrarySearchContext("libraryCollection" in source ? { collections: [source.libraryCollection] } : { readerList });
	try {
		const { keys, total } = await readSearchKeys(config, context, allowed, signal, { offset: first - 1, count: until - first + 1 });
		return { keys, total, truncated: false };
	} catch (error) {
		if (!(error instanceof LibraryExportError)) throw error;
		return error.code === "exportChanged" ? refusals.indexChanged : refusals.invalid(error.message);
	}
}

/**
 * A source's record keys from `first` to `last` (from 1), in its order: a search's and a collection's as the library
 * lists them, the whole library in key order, a list as given. Only public records count. `total` is how many the
 * source holds, up to the cap, past which `truncated` says there are more.
 */
export async function resolveSource(
	config: LibraryServerConfig,
	database: Database,
	readerId: string | null,
	{ source, first, last }: { source: LibrarySource; first: number; last?: number },
	signal: AbortSignal,
): Promise<Resolved> {
	const range = { first, until: last ?? first + RESOLVE_MAX_KEYS - 1 };
	if (range.until < first) return refusals.invalid("Pick records from 1 up, with the first before the last.");
	if (range.until - first + 1 > RESOLVE_MAX_KEYS) return refusals.tooMany;
	if ("library" in source) return await resolveLibrary(config, database, range);
	if ("records" in source) return await resolveRecords(config, database, source.records, range);
	return await resolveSearch(config, database, readerId, source, range, signal);
}

/**
 * How many public records the library holds, and its own collections, each with the public records a search of it
 * finds (its sub-collections' too), which is what resolving it reads.
 */
/** Most countries a library's overview names: the ones most of its public records are about, for OpenScholar's directory card. */
const OVERVIEW_COUNTRIES = 5;

/** The countries most of the public records are about, most first, then by code, each with how many records name it. */
function topCountries(counts: Record<string, number>) {
	return Object.entries(counts)
		.filter(([, records]) => records > 0)
		.sort(([a, first], [b, second]) => second - first || a.localeCompare(b))
		.slice(0, OVERVIEW_COUNTRIES)
		.map(([code, records]) => ({ code, records }));
}

export async function readLibraryOverview(config: LibraryServerConfig, database: Database) {
	const [status, collections, counted] = await Promise.all([
		readPublicLibraryStatus(database, config),
		getCachedCollections(config),
		searchRecords(config, {
			text: "",
			fields: [],
			filters: publicRecordFilters(config.content.tags.hidden),
			size: 0,
			exactTotal: false,
			facets: ["collectionsAncestry", "country"],
		}),
	]);
	const records = counted.facets.collectionsAncestry ?? {};
	return {
		records: Number(status?.totalItems ?? 0),
		countries: topCountries(counted.facets.country ?? {}),
		collections: collections
			.filter((collection) => !collection.deleted)
			.map((collection) => ({ key: collection.key, name: collection.title || collection.name || collection.key, parent: collection.parentCollection ?? null, records: records[collection.key] ?? 0 })),
	};
}

export const batchRequestSchema = z.object({ keys: z.array(z.string().min(1).max(64)).min(1).max(BATCH_MAX_KEYS) }).strict();

/**
 * Public records by key, in the order asked, as the search index holds them with their public files. Keys that name
 * no public record are left out; ones past the byte budget come back in `unread`, to be asked for again.
 */
export async function readRecords(config: LibraryServerConfig, database: Database, keys: string[]): Promise<{ records: OpenScholarRecord[]; unread: string[] }> {
	// Public now in the database, and in the index, which may still hold a record hidden or deleted since.
	const unique = await publicKeys(config, database, keys);
	if (!unique.length) return { records: [], unread: [] };
	// The index keeps hidden and deleted records too: a record hidden since the source was resolved isn't read.
	const found = await searchRecords(config, {
		text: "",
		fields: [],
		filters: [fieldIn("key", unique), ...publicRecordFilters(config.content.tags.hidden)],
		size: unique.length,
		exactTotal: false,
		returned: publicFields(config),
	});
	const rules = publicTagRules(config);
	const byKey = new Map(found.hits.map((record) => [String(record.key), record]));
	const records: OpenScholarRecord[] = [];
	const unread: string[] = [];
	let bytes = 0;
	for (const key of unique) {
		const hit = byKey.get(key);
		if (!hit) continue;
		if (unread.length) {
			unread.push(key);
			continue;
		}
		const record = toOpenScholarRecord({ ...hit, attachmentsData: filterPublicAttachments(hit, rules) } as never);
		const size = Buffer.byteLength(JSON.stringify(record));
		if (records.length && bytes + size > BATCH_MAX_BYTES) {
			unread.push(key);
			continue;
		}
		bytes += size;
		records.push(record);
	}
	return { records, unread };
}

/** Most papers one match takes. */
const MATCH_MAX = 500;
export const matchRequestSchema = z
	.object({
		reader: z.string().max(512).nullable().optional(),
		papers: z.array(z.object({ openalexId: z.string().max(64).optional(), doi: z.string().max(512).optional() }).strict()).max(MATCH_MAX),
	})
	.strict();

/** An OpenAlex work in one form, W and its number, from an address or an ID. */
const workOf = (id: string | undefined) => id?.trim().match(/(?:^|\/)(W[1-9]\d*)$/iu)?.[1]?.toUpperCase() ?? null;

/**
 * The public records this library holds for papers named by their OpenAlex ID or DOI, each with the paper's place in
 * the list (`at`): a record imported from OpenAlex by its work, or by a work merged into it as a repeat; any record by
 * its DOI, the first by key when several share one. A paper it doesn't hold has none.
 * ponytail: a DOI is matched by scanning the library's records; index it if libraries grow past a few hundred thousand.
 */
export async function matchRecords(config: LibraryServerConfig, database: Database, papers: z.infer<typeof matchRequestSchema>["papers"]) {
	const works = [...new Set(papers.flatMap((paper) => workOf(paper.openalexId) ?? []))];
	const dois = [...new Set(papers.flatMap((paper) => normalizeDoi(paper.doi) ?? []))];
	if (!works.length && !dois.length) return [];
	// normalizeDoi in SQL: without its address, `doi:` or angle brackets, in lower case.
	const bareDoi = sql<string>`lower(regexp_replace(regexp_replace(regexp_replace(trim(${item.DOI}), '^https?://(dx\\.)?doi\\.org/', '', 'i'), '^doi:\\s*', '', 'i'), '^<(.+)>$', '\\1'))`;
	const [workKeys, doiRows] = await Promise.all([
		openAlexItemKeys(database, works),
		dois.length ? database.select({ key: item.key, doi: bareDoi }).from(item).where(and(publicParentVisibility(database, config.content.tags.hidden), inArray(bareDoi, dois))).orderBy(item.key) : [],
	]);
	const shown = new Set(await publicKeys(config, database, [...workKeys.values()]));
	const byDoi = new Map<string, string>();
	for (const row of doiRows) if (!byDoi.has(row.doi)) byDoi.set(row.doi, row.key);
	return papers.flatMap((paper, at) => {
		const work = workKeys.get(workOf(paper.openalexId) ?? "");
		const key = (work && shown.has(work) ? work : undefined) ?? byDoi.get(normalizeDoi(paper.doi) ?? "");
		return key ? [{ at, key }] : [];
	});
}

