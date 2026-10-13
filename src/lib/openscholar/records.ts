import type { ListItem } from "@/app/api/item/types";
import { isOpenAlexWorkProvider } from "@/lib/source-providers";

/**
 * A library record as OpenScholar reads it (plans/evidence-library-sources in OpenScholar): what
 * screening and extraction need, and its OpenAlex ID and DOI, which find the same paper elsewhere.
 * Text is capped at the lengths OpenScholar keeps a Zotero paper's.
 */
export type OpenScholarRecord = {
	key: string;
	revision: number;
	itemType: string;
	title: string;
	abstract: string | null;
	creators: Array<{ name: string }>;
	year: number | null;
	venue: string | null;
	url: string | null;
	crossRefs: { openalexId?: string; doi?: string };
	files: Array<{ attachmentKey: string; filename: string | null; contentType: string }>;
};

const RECORD_TITLE_MAX = 500;
const RECORD_ABSTRACT_MAX = 10_000;
const RECORD_NAME_MAX = 300;
const RECORD_CREATORS_MAX = 100;

const cut = (text: string | null | undefined, max: number) => {
	const value = text?.trim();
	return value ? [...value].slice(0, max).join("") : null;
};

/** A record's year, from its publication date as the library keeps it. */
function yearOf(record: Pick<ListItem, "year" | "date">) {
	const found = `${record.year ?? ""} ${record.date ?? ""}`.match(/\b(1[5-9]\d\d|2\d\d\d)\b/);
	return found ? Number(found[1]) : null;
}

/** A DOI in one form: lower case, without its address. */
function doiOf(doi: string | null | undefined) {
	const bare = doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:/, "").trim();
	return bare || undefined;
}

type RecordSource = Pick<ListItem, "key" | "revision" | "itemType" | "title" | "abstractNote" | "creators" | "year" | "date" | "publicationTitle" | "url" | "DOI" | "provider"> & {
	sourceRecordKey?: string | null;
	attachmentsData?: Array<{ key: string; filename?: string | null; contentType?: string | null; linkMode?: string | null }>;
};

/** A record, from the search index's copy of it with its public attachments only, as OpenScholar reads it. */
export function toOpenScholarRecord(record: RecordSource): OpenScholarRecord {
	const openalexId = isOpenAlexWorkProvider(record.provider) && /^W[1-9]\d*$/.test(record.sourceRecordKey ?? "") ? record.sourceRecordKey! : undefined;
	const doi = doiOf(record.DOI);
	return {
		key: record.key,
		revision: Number(record.revision ?? 1),
		itemType: String(record.itemType ?? ""),
		title: cut(record.title, RECORD_TITLE_MAX) ?? "",
		abstract: cut(record.abstractNote, RECORD_ABSTRACT_MAX),
		creators: (record.creators ?? []).slice(0, RECORD_CREATORS_MAX).flatMap((creator) => {
			const name = cut(creator.name ?? [creator.firstName, creator.lastName].filter(Boolean).join(" "), RECORD_NAME_MAX);
			return name ? [{ name }] : [];
		}),
		year: yearOf(record),
		venue: cut(record.publicationTitle, RECORD_NAME_MAX),
		url: record.url?.trim() || null,
		crossRefs: { ...(openalexId ? { openalexId } : {}), ...(doi ? { doi } : {}) },
		files: (record.attachmentsData ?? []).flatMap((file) =>
			file.contentType?.toLowerCase().includes("pdf") ? [{ attachmentKey: file.key, filename: file.filename ?? null, contentType: "application/pdf" }] : [],
		),
	};
}
