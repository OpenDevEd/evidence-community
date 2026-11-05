import { CANONICAL_RECORD_KEY_ALPHABET, CANONICAL_RECORD_KEY_LENGTH } from "@opendeved/evidence-library-core";

import { INSTITUTION_FILTER_FIELD, institutionNameKey } from "@/config/library-config/institutions";
import { sourceRecordValidationOptions, validateNativeItemDraft } from "@/lib/admin/native-item-validation";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { bibliographicDateSearchFields } from "@/lib/bibliographic-date";
import { resolveCountryFocus } from "@/lib/country-focus";
import { resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";
import { PDF_PRESENCE_ATTRIBUTE, SOURCES_FIELD } from "@/lib/search-filter-constants";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { workIsOpenAccess } from "@/lib/source-ingestion/openalex/work";
import type { item } from "@/db/schema/tables/item";
import { cleanRow, creatorNames, type ItemSearchDocument, metadataSearchValues, uniqueSorted } from "./projection";

type ItemRow = typeof item.$inferSelect;
type MappedRecord = ReturnType<typeof mapOpenAlexWork>["items"][number];

export type IndexOnlyOptions = { sourceConnectionKey: string; loadedAt: Date };

/** Keeps a work's PDF link clear of every work's own key: OpenAlex's ids stay far below this. */
const ATTACHMENT_OFFSET = 700_000_000_000;

/** A record's key: its number written in the record alphabet, so a load needs no database to keep keys unique or stable. */
export function indexOnlyKey(id: number) {
	const base = CANONICAL_RECORD_KEY_ALPHABET.length;
	let rest = id;
	let key = "";
	for (let place = 0; place < CANONICAL_RECORD_KEY_LENGTH; place++) {
		key = CANONICAL_RECORD_KEY_ALPHABET[rest % base] + key;
		rest = Math.floor(rest / base);
	}
	if (rest > 0) throw new Error(`Record number ${id} is too large for a record key`);
	return key;
}

function rowOf(record: MappedRecord, key: string, { sourceConnectionKey, loadedAt }: IndexOnlyOptions, parentItem: string | null) {
	const { item: fields, tags } = validateNativeItemDraft(record.metadata, sourceRecordValidationOptions);
	const file = record.file;
	const row = {
		...fields,
		key,
		parentItem,
		sourceConnectionKey,
		sourceRecordKey: record.sourceRecordKey,
		revision: 1,
		deleted: 0,
		topics: fields.topics ?? [],
		dateAdded: record.sourceDates?.addedAt ?? null,
		dateModified: record.sourceDates?.modifiedAt ?? null,
		createdAt: loadedAt,
		updatedAt: loadedAt,
		...(file ? { url: file.url, contentType: file.contentType, filename: file.filename, linkMode: file.linkMode } : {}),
	} as unknown as ItemRow;
	return { row, tags };
}

/** The search document the projection would make of this work, without a database to read it back from. */
export function documentFromWork(work: unknown, options: IndexOnlyOptions): ItemSearchDocument {
	const { items, institutions } = mapOpenAlexWork(work);
	const [record, pdf] = items as [MappedRecord, MappedRecord | undefined];
	const id = Number(record.sourceRecordKey.slice(1));
	const key = indexOnlyKey(id);
	const { row: parent, tags } = rowOf(record, key, options, null);
	const child = pdf ? rowOf(pdf, indexOnlyKey(id + ATTACHMENT_OFFSET), options, key).row : null;
	const attachmentsData = child ? [{ ...cleanRow({ ...child, fullTextPDF: null }), tags: [] }] : [];
	const metric = record.citationMetric;
	const institutionNames = new Map<string, string>();
	for (const creator of (parent.creators ?? []) as { institutions?: { display_name: string }[] }[]) {
		for (const { display_name: name } of creator.institutions ?? []) institutionNames.set(institutionNameKey(name), name);
	}
	return {
		...cleanRow(parent),
		DOI: resolvePublicDoi({ ...parent, attachments: child ? [{ url: child.url, tags: [] }] : [] }),
		[PDF_PRESENCE_ATTRIBUTE]: Boolean(child && isVisiblePdfAttachment(child)),
		...bibliographicDateSearchFields(parent.date),
		attachmentsData,
		citationMetrics: metric
			? [
					{
						sourceConnectionKey: options.sourceConnectionKey,
						sourceLabel: "Openscholar",
						provider: "openalex",
						workId: record.sourceRecordKey,
						...metric,
						observedAt: options.loadedAt.toISOString(),
					},
				]
			: [],
		citationCount: metric?.citedByCount ?? 0,
		collections: [],
		collectionsAncestry: [],
		country: resolveCountryFocus(parent),
		authorCountry: uniqueSorted(institutions.map(({ countryCode }) => countryCode)),
		deleted: 0,
		fullNames: creatorNames(parent.creators),
		fullTextPDFs: [],
		institution: [],
		[INSTITUTION_FILTER_FIELD]: [...institutionNames.values()],
		links: { cites: [], citedBy: [], related: [] },
		metadataSearch: metadataSearchValues(parent),
		openAccess: workIsOpenAccess(work) ?? false,
		topicAncestors: [],
		topics: [],
		key,
		provider: "openalex",
		revision: 1,
		sourceConnectionKey: options.sourceConnectionKey,
		sourceExternalScopeKey: null,
		sourceRecordKey: record.sourceRecordKey,
		[SOURCES_FIELD]: [options.sourceConnectionKey],
		tags: uniqueSorted(tags),
	};
}
