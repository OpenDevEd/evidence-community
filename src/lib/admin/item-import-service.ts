import { itemDraft, itemIdentity } from "@opendeved/evidence-library-core";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { eq, inArray, or, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { reserveItemIdentity } from "@/db/record-identity";
import { publicationIdentifier } from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";
import { parseBibliographicDate } from "@/lib/bibliographic-date";
import { normalizeDoi } from "@/lib/doi";
import { reportZoteroItem } from "@/lib/openscholar-report";
import type { OpenscholarReport } from "@/lib/openscholar-service";
import type { PaperIds } from "@/lib/paper-links";
import { zoteroDataToCanonicalMetadata } from "@/lib/source-ingestion/zotero/mapper";
import {
	importZoteroBibliography,
	searchZoteroIdentifier,
} from "@/lib/zotero-translation";

import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";
import { isTopLevelAdminItemType } from "./item-fields";
import { AdminValidationError, type AdminFieldErrors } from "./errors";
import {
	ADMIN_IMPORT_MAX_RECORDS,
	type AdminImportCommitRequest,
	type AdminImportCommitResponse,
	type AdminImportCommitResult,
	type AdminImportPreviewRecord,
	type AdminImportPreviewRequest,
	type AdminImportPreviewResponse,
	type AdminImportRecordState,
} from "./item-import-contract";
import { assertValidItemCollectionMembershipsInDatabase } from "./native-item-service";
import {
	NativeItemValidationError,
	validateNativeItemDraft,
} from "./native-item-validation";

type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

const DOI_LOOKUP_CONCURRENCY = 4;

// Translation-server items carry children and Zotero bookkeeping the native
// draft validator does not accept. Attachments and notes are out of scope.
const importOnlyFields = new Set([
	"attachments",
	"collections",
	"notes",
	"parentItem",
	"relations",
	"seeAlso",
]);

/**
 * Translators return dates in many shapes ("8/2013", "2013-08", "August
 * 2013"). The draft validator accepts only an exact date or a year.
 */
export function importDateValue(value: string) {
	if (parseBibliographicDate(value).kind !== "invalid") return value;
	const monthDayYear = /^(\d{1,2})\/(\d{1,2})\/([12]\d{3})$/u.exec(value.trim());
	if (monthDayYear) {
		const [, month, day, year] = monthDayYear;
		const iso = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
		if (parseBibliographicDate(iso).kind === "parsed") return iso;
	}
	// ponytail: only ISO month precision is kept ("2013-08"); other month
	// formats fall back to the year so the record still imports.
	return /[12]\d{3}/u.exec(value)?.[0] ?? value;
}

/** Maps one translation-server item to a native draft payload. */
export function importPayloadFromZoteroItem(zoteroItem: Record<string, unknown>) {
	const itemType =
		typeof zoteroItem.itemType === "string" ? zoteroItem.itemType : "";
	const tags = Array.isArray(zoteroItem.tags)
		? zoteroItem.tags.filter(
				(tag): tag is { tag: string } =>
					Boolean(tag) &&
					typeof tag === "object" &&
					typeof (tag as { tag?: unknown }).tag === "string",
			)
		: [];
	const metadata = zoteroDataToCanonicalMetadata({
		...Object.fromEntries(
			Object.entries(zoteroItem).filter(
				([field]) => !importOnlyFields.has(field),
			),
		),
		itemType,
		tags,
	});
	if (typeof metadata.date === "string") {
		metadata.date = importDateValue(metadata.date);
	}
	return { ...metadata, collections: [] } as Record<string, unknown>;
}

export type ImportIdentifiers = {
	doi: string | null;
	isbn: string | null;
	pmid: string | null;
};

function normalizeIsbn(value: unknown) {
	if (typeof value !== "string") return null;
	const digits = value.replace(/[^0-9Xx]/gu, "").toUpperCase();
	return digits.length === 10 || digits.length === 13 ? digits : null;
}

function normalizePmid(value: unknown) {
	if (typeof value !== "string") return null;
	const digits = value.replace(/^\s*(?:PMID:?\s*)?/iu, "").trim();
	return /^\d+$/u.test(digits) ? digits : null;
}

export function importIdentifiers(
	payload: Record<string, unknown>,
): ImportIdentifiers {
	return {
		doi: typeof payload.DOI === "string" ? normalizeDoi(payload.DOI) : null,
		isbn: normalizeIsbn(payload.ISBN),
		pmid: normalizePmid(payload.PMID),
	};
}

export type ExistingRecordIndex = Record<
	keyof ImportIdentifiers,
	ReadonlyMap<string, string>
>;

/**
 * Finds library records (published or draft) that share an exact DOI, PMID
 * or ISBN with the import, a DOI the library issued through Crossref or
 * Zenodo included. Title matching is deliberately not attempted.
 */
export async function findExistingRecords(
	db: Executor,
	identifiers: readonly ImportIdentifiers[],
): Promise<ExistingRecordIndex> {
	const dois = [...new Set(identifiers.flatMap(({ doi }) => (doi ? [doi] : [])))];
	const pmids = [...new Set(identifiers.flatMap(({ pmid }) => (pmid ? [pmid] : [])))];
	const isbns = [...new Set(identifiers.flatMap(({ isbn }) => (isbn ? [isbn] : [])))];
	const index: ExistingRecordIndex = {
		doi: new Map<string, string>(),
		isbn: new Map<string, string>(),
		pmid: new Map<string, string>(),
	};
	if (dois.length + pmids.length + isbns.length === 0) return index;

	const isbnExpression = (column: ReturnType<typeof sql>) =>
		sql`upper(regexp_replace(${column}, '[^0-9Xx]', '', 'g'))`;
	// Stored DOIs may carry a doi.org or "doi:" prefix; match what normalizeDoi keeps.
	const doiExpression = (column: ReturnType<typeof sql>) =>
		sql`regexp_replace(lower(trim(${column})), '^(https?://(dx\\.)?doi\\.org/|doi:\\s*)', '')`;
	const conditions = (
		doi: ReturnType<typeof sql>,
		pmid: ReturnType<typeof sql>,
		isbn: ReturnType<typeof sql>,
	) =>
		or(
			...[
				dois.length ? [inArray(doiExpression(doi), dois)] : [],
				pmids.length ? [inArray(sql`regexp_replace(${pmid}, '\\D', '', 'g')`, pmids)] : [],
				isbns.length ? [inArray(isbnExpression(isbn), isbns)] : [],
			].flat(),
		);

	const [published, issued, drafts] = await Promise.all([
		db
			.select({ key: item.key, DOI: item.DOI, ISBN: item.ISBN, PMID: item.PMID })
			.from(item)
			.where(conditions(sql`${item.DOI}`, sql`${item.PMID}`, sql`${item.ISBN}`)),
		// Issued DOIs are stored normalized, and a record may carry its own only here.
		dois.length
			? db
					.select({ key: publicationIdentifier.itemKey, DOI: publicationIdentifier.doi })
					.from(publicationIdentifier)
					.where(inArray(publicationIdentifier.doi, dois))
			: [],
		db
			.select({
				key: itemDraft.itemKey,
				DOI: sql<string | null>`${itemDraft.patch}->>'DOI'`,
				ISBN: sql<string | null>`${itemDraft.patch}->>'ISBN'`,
				PMID: sql<string | null>`${itemDraft.patch}->>'PMID'`,
			})
			.from(itemDraft)
			.where(
				conditions(
					sql`${itemDraft.patch}->>'DOI'`,
					sql`${itemDraft.patch}->>'PMID'`,
					sql`${itemDraft.patch}->>'ISBN'`,
				),
			),
	]);

	const maps = {
		doi: index.doi as Map<string, string>,
		isbn: index.isbn as Map<string, string>,
		pmid: index.pmid as Map<string, string>,
	};
	// Published rows first so a draft of a published record never shadows it.
	for (const row of [...published, ...issued, ...drafts]) {
		const found = importIdentifiers(row);
		for (const kind of ["doi", "pmid", "isbn"] as const) {
			const value = found[kind];
			if (value && !maps[kind].has(value)) maps[kind].set(value, row.key);
		}
	}
	return index;
}

type DuplicateCandidate = {
	existingKey?: string;
	identifiers: ImportIdentifiers | null;
	state: AdminImportRecordState;
};

/**
 * Marks records that already exist in the library or repeat an earlier
 * record of the same import. Records without identifiers are never marked.
 */
export function assignDuplicateStates<T extends DuplicateCandidate>(
	records: readonly T[],
	existing: ExistingRecordIndex,
): T[] {
	const kinds = ["doi", "pmid", "isbn"] as const;
	const seen = { doi: new Set<string>(), isbn: new Set<string>(), pmid: new Set<string>() };
	return records.map((record) => {
		const identifiers = record.identifiers;
		if (record.state !== "ready" || !identifiers) return record;
		// Every record registers its identifiers, even when it is skipped, so a
		// later record that shares any of them is caught too.
		const existingKey = kinds
			.map((kind) => {
				const value = identifiers[kind];
				return value ? existing[kind].get(value) : undefined;
			})
			.find(Boolean);
		const repeated = kinds.some((kind) => {
			const value = identifiers[kind];
			return value ? seen[kind].has(value) : false;
		});
		for (const kind of kinds) {
			const value = identifiers[kind];
			if (value) seen[kind].add(value);
		}
		if (existingKey) return { ...record, existingKey, state: "existing" };
		return repeated ? { ...record, state: "repeated" } : record;
	});
}

function creatorNames(payload: Record<string, unknown>) {
	if (!Array.isArray(payload.creators)) return [];
	return payload.creators.flatMap((creator) => {
		if (!creator || typeof creator !== "object") return [];
		const { firstName, lastName, name } = creator as Record<string, unknown>;
		const full =
			typeof name === "string" && name.trim()
				? name.trim()
				: [firstName, lastName]
						.filter((part): part is string => typeof part === "string")
						.join(" ")
						.trim();
		return full ? [full] : [];
	});
}

function summary(payload: Record<string, unknown>) {
	const date = typeof payload.date === "string" ? parseBibliographicDate(payload.date) : null;
	return {
		creators: creatorNames(payload),
		itemType: typeof payload.itemType === "string" ? payload.itemType : null,
		title: typeof payload.title === "string" && payload.title ? payload.title : null,
		year: date?.kind === "parsed" ? date.year : null,
	};
}

export type TranslatedEntry =
	| { source: string; zoteroItem: Record<string, unknown> }
	| { message: string; source: string };

/** What an import asks of Openscholar (lib/openscholar-service.ts). */
export type OpenscholarLookups = {
	/** Follows an address given in place of a DOI. */
	papersAtLinks: (links: readonly string[]) => Promise<Array<PaperIds | null>>;
	/** The Openscholar Reports among these DOIs, by DOI. */
	reportsByDoi: (dois: readonly string[]) => Promise<Map<string, OpenscholarReport>>;
};

/** The DOI of each address given in place of one, as Openscholar follows it, 100 at a time; null where it finds none. */
async function doisAtLinks(entries: readonly string[], papersAtLinks: (links: readonly string[]) => Promise<Array<PaperIds | null>>) {
	const links = entries.filter((entry) => !normalizeDoi(entry));
	const followed = new Map<string, PaperIds | null>();
	for (let at = 0; at < links.length; at += 100) {
		const part = links.slice(at, at + 100);
		(await papersAtLinks(part)).forEach((paper, index) => followed.set(part[index]!, paper));
	}
	return followed;
}

/**
 * One DOI through the translation server. It sometimes answers a lookup made beside others with an error for a DOI it
 * finds a moment later, so a failed lookup is tried twice more before it's reported.
 */
async function lookUpDoi(doi: string, translationUrl: string, waits: readonly number[] = [500, 1500]): Promise<Record<string, unknown>[]> {
	try {
		return await searchZoteroIdentifier(doi, translationUrl);
	} catch (error) {
		const [wait, ...rest] = waits;
		if (wait === undefined) throw error;
		await new Promise((resolve) => setTimeout(resolve, wait));
		return await lookUpDoi(doi, translationUrl, rest);
	}
}

async function translateDois(dois: readonly string[], translationUrl: string, { papersAtLinks, reportsByDoi }: OpenscholarLookups) {
	const followed = await doisAtLinks(dois, papersAtLinks);
	const doiOf = (raw: string) => normalizeDoi(raw) ?? followed.get(raw)?.doi ?? null;
	// Openscholar is asked first, once for all of them (OpenDevEd/new-el#814): a report published there is in no DOI
	// lookup until its deposit is indexed, and is imported from Openscholar's own details.
	const asked = [...new Set(dois.flatMap((raw) => doiOf(raw) ?? []))];
	const reports = asked.length ? await reportsByDoi(asked) : new Map<string, OpenscholarReport>();
	return mapWithConcurrency(dois, DOI_LOOKUP_CONCURRENCY, async (raw): Promise<TranslatedEntry[]> => {
		const doi = doiOf(raw);
		if (!doi) return [{ message: !followed.has(raw) ? "This is not a valid DOI." : followed.get(raw) ? "Openscholar knows this paper but not its DOI." : "Openscholar finds no paper at this address.", source: raw }];
		const report = reports.get(doi);
		if (report) return report.state === "live" ? [{ source: doi, zoteroItem: reportZoteroItem(report) }] : [{ message: "This report was withdrawn on Openscholar.", source: doi }];
		try {
			const [found] = await lookUpDoi(doi, translationUrl);
			return found
				? [{ source: doi, zoteroItem: found }]
				: [{ message: "No record was found for this DOI.", source: doi }];
		} catch (error) {
			console.error("DOI lookup failed", doi, error);
			return [{ message: "The DOI lookup failed. Try again later.", source: doi }];
		}
	});
}

async function translateFiles(
	files: AdminImportPreviewRequest["files"],
	translationUrl: string,
) {
	return mapWithConcurrency(files, 2, async (file): Promise<TranslatedEntry[]> => {
		try {
			const found = await importZoteroBibliography(file.content, translationUrl, file.name);
			return found.length
				? found.map((zoteroItem) => ({ source: file.name, zoteroItem }))
				: [{ message: "No records were found in this file.", source: file.name }];
		} catch (error) {
			console.error("Bibliography import failed", file.name, error);
			return [{ message: "This file could not be read. Check that it is one of the supported formats.", source: file.name }];
		}
	});
}

export async function previewImportRecords(
	db: Executor,
	input: AdminImportPreviewRequest,
	translationUrl: string,
	openscholar: OpenscholarLookups,
): Promise<AdminImportPreviewResponse> {
	const [doiEntries, fileEntries] = await Promise.all([
		translateDois(input.dois, translationUrl, openscholar),
		translateFiles(input.files, translationUrl),
	]);
	return previewEntries(db, [
		...doiEntries.flat().map((entry) => ({ ...entry, method: "doi" as const })),
		...fileEntries.flat().map((entry) => ({ ...entry, method: "file" as const })),
	]);
}

/** Validates translated entries and marks the ones the library already has. */
export async function previewEntries(
	db: Executor,
	translated: readonly (TranslatedEntry & { method: "doi" | "file" | "pdf" })[],
): Promise<AdminImportPreviewResponse> {
	// Attachments, notes and annotations belong to a parent record and are
	// out of scope for imports.
	const entries = translated.filter(
		(entry) =>
			!("zoteroItem" in entry) ||
			isTopLevelAdminItemType(String(entry.zoteroItem.itemType)),
	);
	if (entries.length > ADMIN_IMPORT_MAX_RECORDS) {
		throw new AdminValidationError(
			`Import no more than ${ADMIN_IMPORT_MAX_RECORDS} records at once. This import has ${entries.length}.`,
		);
	}

	const records = entries.map((entry, index): AdminImportPreviewRecord & DuplicateCandidate => {
		const id = String(index + 1);
		const base = { creators: [], id, method: entry.method, itemType: null, payload: null, source: entry.source, title: null, year: null };
		if (!("zoteroItem" in entry)) {
			return { ...base, identifiers: null, message: entry.message, state: "unresolved" as const };
		}
		const payload = importPayloadFromZoteroItem(entry.zoteroItem);
		try {
			const validated = validateNativeItemDraft(payload, { allowIncompleteCreators: true });
			return {
				...base,
				...summary(validated.payload),
				identifiers: importIdentifiers(validated.payload),
				payload: validated.payload,
				state: "ready" as const,
			};
		} catch (error) {
			if (!(error instanceof NativeItemValidationError)) throw error;
			return {
				...base,
				...summary(payload),
				fields: error.fields,
				identifiers: null,
				message: error.message,
				state: "attention" as const,
			};
		}
	});

	const existing = await findExistingRecords(
		db,
		records.flatMap(({ identifiers }) => (identifiers ? [identifiers] : [])),
	);
	return {
		records: assignDuplicateStates(records, existing).map(
			({ identifiers: _identifiers, ...record }) => record,
		),
	};
}

export async function commitImportRecords(
	db: Database | DatabaseTransaction,
	input: AdminImportCommitRequest,
): Promise<AdminImportCommitResponse> {
	type PreparedRecord = DuplicateCandidate & {
		fields?: AdminFieldErrors;
		id: string;
		method: "doi" | "file" | "pdf";
		message?: string;
		payload: Record<string, unknown> | null;
	};
	// The import's collections, and those a record was given on its own, such as the ones the AI chose for a PDF. A value
	// that isn't a list goes to validation as it is, which refuses it.
	const collectionsOf = (payload: Record<string, unknown>) =>
		payload.collections === undefined ? input.collections : Array.isArray(payload.collections) ? [...new Set([...input.collections, ...payload.collections])] : payload.collections;
	const prepared = input.records.map((record): PreparedRecord => {
		try {
			const validated = validateNativeItemDraft(
				{ ...record.payload, collections: collectionsOf(record.payload) },
				{ allowIncompleteCreators: true },
			);
			if (!isTopLevelAdminItemType(validated.item.itemType)) {
				throw new NativeItemValidationError(
					"Attachments, notes and annotations cannot be imported.",
					{ itemType: "Choose a record type that can stand on its own." },
				);
			}
			return {
				id: record.id,
				method: record.method,
				identifiers: importIdentifiers(validated.payload),
				payload: validated.payload,
				state: "ready" as const,
			};
		} catch (error) {
			if (!(error instanceof NativeItemValidationError)) throw error;
			return {
				fields: error.fields,
				id: record.id,
				method: record.method,
				identifiers: null,
				message: error.message,
				payload: null,
				state: "attention" as const,
			};
		}
	});

	return db.transaction(async (transaction) => {
		// One import commits at a time, so a retried or concurrent commit sees
		// the drafts the first one created instead of racing its duplicate check.
		await transaction.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended('item-import', 0))`,
		);
		await assertValidItemCollectionMembershipsInDatabase(
			transaction,
			null,
			NATIVE_SOURCE_CONNECTION_KEY,
			[...new Set(prepared.flatMap(({ payload }) => (Array.isArray(payload?.collections) ? (payload.collections as string[]) : [])))],
		);
		const existing = await findExistingRecords(
			transaction,
			prepared.flatMap(({ identifiers }) => (identifiers ? [identifiers] : [])),
		);
		const decided = assignDuplicateStates(prepared, existing);
		const ready = decided.filter(
			(record): record is PreparedRecord & { payload: Record<string, unknown> } =>
				record.state === "ready" && record.payload !== null,
		);
		// ponytail: a retried commit is safe for records with a DOI, PMID or
		// ISBN because the duplicate check above skips them. Records without
		// any identifier can only repeat when the first commit succeeded but
		// its response was lost; a schema-level import id would close that.
		const keys = new Map<string, string>();
		const kinds = new Map<string, "created" | "imported">();
		for (const record of ready) {
			const key = await reserveItemIdentity(transaction, {
				sourceConnectionKey: NATIVE_SOURCE_CONNECTION_KEY,
			});
			// A PDF with no DOI is the library's own work, so it publishes
			// with a DOI the library registers, like a record made here.
			const kind = record.method === "pdf" && !record.identifiers?.doi ? "created" : "imported";
			await transaction.update(itemIdentity)
				.set(kind === "created" ? { kind, importMethod: null } : { kind, importMethod: record.method === "pdf" ? "file" : record.method })
				.where(eq(itemIdentity.key, key));
			keys.set(record.id, key);
			kinds.set(record.id, kind);
		}
		if (ready.length) {
			await transaction.insert(itemDraft).values(
				ready.map((record) => ({
					itemKey: keys.get(record.id)!,
					patch: record.payload,
					sourceConnectionKey: NATIVE_SOURCE_CONNECTION_KEY,
				})),
			);
		}
		return {
			results: decided.map((record): AdminImportCommitResult => {
				if (record.state === "ready") {
					return {
						id: record.id,
						itemKey: keys.get(record.id)!,
						kind: kinds.get(record.id),
						outcome: "created",
					};
				}
				if (record.state === "attention") {
					return { fields: record.fields, id: record.id, message: record.message, outcome: "failed" };
				}
				return {
					existingKey: record.existingKey,
					id: record.id,
					message:
						record.state === "existing"
							? "This record is already in the community."
							: "This record repeats an earlier record of the import.",
					outcome: "skipped",
				};
			}),
		};
	});
}
