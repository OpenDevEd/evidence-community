import { itemDraft } from "@opendeved/evidence-library-core";
import { inArray, or, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { reserveItemIdentity } from "@/db/record-identity";
import { item } from "@/db/schema/tables/item";
import { parseBibliographicDate } from "@/lib/bibliographic-date";
import { normalizeDoi } from "@/lib/doi";
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
 * or ISBN with the import. Title matching is deliberately not attempted.
 */
async function findExistingRecords(
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

	const [published, drafts] = await Promise.all([
		db
			.select({ key: item.key, DOI: item.DOI, ISBN: item.ISBN, PMID: item.PMID })
			.from(item)
			.where(conditions(sql`${item.DOI}`, sql`${item.PMID}`, sql`${item.ISBN}`)),
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
	for (const row of [...published, ...drafts]) {
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

type TranslatedEntry =
	| { source: string; zoteroItem: Record<string, unknown> }
	| { message: string; source: string };

async function mapWithConcurrency<T, R>(
	values: readonly T[],
	limit: number,
	run: (value: T) => Promise<R>,
) {
	const results: R[] = new Array(values.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, values.length) }, async () => {
			while (next < values.length) {
				const index = next++;
				results[index] = await run(values[index]!);
			}
		}),
	);
	return results;
}

async function translateDois(dois: readonly string[], translationUrl: string) {
	return mapWithConcurrency(dois, DOI_LOOKUP_CONCURRENCY, async (raw): Promise<TranslatedEntry[]> => {
		const doi = normalizeDoi(raw);
		if (!doi) return [{ message: "This is not a valid DOI.", source: raw }];
		try {
			const [found] = await searchZoteroIdentifier(doi, translationUrl);
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
): Promise<AdminImportPreviewResponse> {
	const [doiEntries, fileEntries] = await Promise.all([
		translateDois(input.dois, translationUrl),
		translateFiles(input.files, translationUrl),
	]);
	// Attachments, notes and annotations belong to a parent record and are
	// out of scope for imports.
	const entries = [...doiEntries.flat(), ...fileEntries.flat()].filter(
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
		const base = { creators: [], id, itemType: null, payload: null, source: entry.source, title: null, year: null };
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
	db: Database,
	input: AdminImportCommitRequest,
): Promise<AdminImportCommitResponse> {
	type PreparedRecord = DuplicateCandidate & {
		fields?: AdminFieldErrors;
		id: string;
		message?: string;
		payload: Record<string, unknown> | null;
	};
	const prepared = input.records.map((record): PreparedRecord => {
		try {
			const validated = validateNativeItemDraft(
				{ ...record.payload, collections: input.collections },
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
				identifiers: importIdentifiers(validated.payload),
				payload: validated.payload,
				state: "ready" as const,
			};
		} catch (error) {
			if (!(error instanceof NativeItemValidationError)) throw error;
			return {
				fields: error.fields,
				id: record.id,
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
			input.collections,
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
		for (const record of ready) {
			keys.set(
				record.id,
				await reserveItemIdentity(transaction, {
					sourceConnectionKey: NATIVE_SOURCE_CONNECTION_KEY,
				}),
			);
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
							? "This record is already in the library."
							: "This record repeats an earlier record of the import.",
					outcome: "skipped",
				};
			}),
		};
	});
}
