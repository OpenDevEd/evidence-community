import {
	describeZoteroItemTypeFields,
	getZoteroItemType,
} from "@opendeved/evidence-library-core/zotero-schema";
import { institutionNameKey } from "@/config/library-config/institutions";
import {
	MAX_CREATOR_INSTITUTIONS,
	MAX_CREATOR_INSTITUTION_NAME_LENGTH,
	sourceRecordValidationOptions,
	validateNativeItemDraft,
} from "@/lib/admin/native-item-validation";
import { countryFocusNames } from "@/lib/country-focus";
import { normalizeDoi } from "@/lib/doi";
import { canonicalItemTypeToZotero } from "@/lib/item-field-codec";
import { jsonObjectSchema, type SourceItemUpsert } from "../batch-schema";
import { openAlexWorkSchema, type OpenAlexWork } from "./work";

const itemTypes = new Map(
	Object.entries({
		article: "JournalArticle",
		"book-review": "JournalArticle",
		"data-paper": "JournalArticle",
		"software-paper": "JournalArticle",
		editorial: "JournalArticle",
		erratum: "JournalArticle",
		letter: "JournalArticle",
		retraction: "JournalArticle",
		review: "JournalArticle",
		book: "Book",
		"edited-book": "Book",
		"book-chapter": "BookSection",
		"conference-paper": "ConferencePaper",
		dataset: "Dataset",
		dissertation: "Thesis",
		libguides: "Webpage",
		preprint: "Preprint",
		"reference-entry": "EncyclopediaArticle",
		report: "Report",
		software: "ComputerProgram",
		standard: "Standard",
	}),
);

type Location = NonNullable<OpenAlexWork["primary_location"]>;
type Source = NonNullable<Location["source"]>;
type Authorship = NonNullable<OpenAlexWork["authorships"]>[number];
type Institution = NonNullable<Authorship["institutions"]>[number];
type InstitutionFact = {
	name: string;
	countryCode: string;
	openalexId: string | null;
	city: null;
};

const containerSourceTypes = new Set([
	"JournalArticle:journal",
	"ConferencePaper:conference",
]);
const publisherSourceTypes = new Set([
	"journal",
	"conference",
	"ebook platform",
]);

function text(value: string | null | undefined) {
	return value?.trim() || null;
}

function httpUrl(value: string | null | undefined) {
	const trimmed = text(value);
	if (!trimmed || trimmed.length > 2048) return null;
	try {
		const url = new URL(trimmed);
		return url.protocol === "http:" || url.protocol === "https:"
			? trimmed
			: null;
	} catch {
		return null;
	}
}

function date(value: string | null | undefined) {
	if (!value) return null;
	// OpenAlex timestamps without an offset are UTC, independent of worker timezone.
	const parsed = new Date(
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
			? `${value}Z`
			: value,
	);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function preferredPdf(work: OpenAlexWork) {
	const eligible = (
		location: Location | null | undefined,
	): location is Location =>
		location?.is_oa === true && httpUrl(location.pdf_url) !== null;
	if (eligible(work.best_oa_location)) return work.best_oa_location;
	const versions = new Map([
		["publishedVersion", 0],
		["acceptedVersion", 1],
		["submittedVersion", 2],
	]);
	return [work.primary_location, ...(work.locations ?? [])]
		.filter(eligible)
		.sort(
			(left, right) =>
				(versions.get(left.version ?? "") ?? 3) -
					(versions.get(right.version ?? "") ?? 3) ||
				left.pdf_url!.localeCompare(right.pdf_url!, "en") ||
				JSON.stringify(left).localeCompare(JSON.stringify(right), "en"),
		)[0];
}

function abstract(work: OpenAlexWork) {
	if (!work.abstract_inverted_index) return null;
	return Object.entries(work.abstract_inverted_index)
		.flatMap(([word, positions]) =>
			positions.map((position) => ({ word, position })),
		)
		.sort((left, right) => left.position - right.position)
		.map(({ word }) => word)
		.join(" ");
}

function itemTypeFor(work: OpenAlexWork) {
	return work.type === "article" &&
		work.type_crossref === "proceedings-article"
		? "ConferencePaper"
		: (itemTypes.get(work.type ?? "") ?? "Document");
}

function primaryCreatorType(zoteroType: string) {
	return (
		getZoteroItemType(zoteroType)!.creatorTypes.find(
			(creator) => creator.primary,
		)?.creatorType ?? "author"
	);
}

function landingUrl(work: OpenAlexWork, doi: string | null) {
	return (
		httpUrl(work.primary_location?.landing_page_url) ??
		(doi ? `https://doi.org/${doi}` : null) ??
		httpUrl(work.best_oa_location?.landing_page_url) ??
		(work.locations ?? [])
			.map((location) => httpUrl(location.landing_page_url))
			.find(Boolean) ??
		`https://openalex.org/${work.id.split("/").pop()}`
	);
}

// A repository host, book series or author affiliation does not identify the publisher.
function publisherName(source: Source) {
	return publisherSourceTypes.has(source.type ?? "") &&
		/^(?:https?:\/\/openalex\.org\/)?P\d+$/u.test(
			source.host_organization ?? "",
		)
		? text(source.host_organization_name)
		: null;
}

function sourceFields(
	itemType: string,
	source: Source | null | undefined,
	hasPublisherField: boolean,
): Record<string, string | null> {
	if (!source) return {};
	return {
		publicationTitle: containerSourceTypes.has(`${itemType}:${source.type}`)
			? text(source.display_name)
			: null,
		publisher: hasPublisherField ? publisherName(source) : null,
		series:
			source.type === "book series" ? text(source.display_name) : null,
		ISSN:
			source.type === "journal"
				? (text(source.issn_l) ?? text(source.issn?.[0]))
				: null,
	};
}

function biblioFields(biblio: OpenAlexWork["biblio"]) {
	const pages = [
		...new Set(
			[text(biblio?.first_page), text(biblio?.last_page)].filter(Boolean),
		),
	].join("-");
	return {
		volume: text(biblio?.volume),
		issue: text(biblio?.issue),
		pages: pages || null,
	};
}

function medicalIds(ids: OpenAlexWork["ids"]) {
	return {
		PMID:
			text(ids?.pmid)?.match(
				/^(?:https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d+)\/?$/u,
			)?.[1] ?? null,
		PMCID:
			text(ids?.pmcid)?.match(
				/^(?:https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\/|https?:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/)?(PMC\d+)\/?$/u,
			)?.[1] ?? null,
	};
}

function publicationDate(work: OpenAlexWork) {
	return (
		text(work.publication_date) ??
		(work.publication_year ? String(work.publication_year) : null)
	);
}

function authorName(authorship: Authorship) {
	return (
		text(authorship.raw_author_name) ??
		text(authorship.author?.display_name)
	);
}

function creatorInstitutions(authorship: Authorship) {
	const names = (authorship.institutions ?? []).flatMap((institution) => {
		const name = text(institution.display_name);
		return name && name.length <= MAX_CREATOR_INSTITUTION_NAME_LENGTH
			? [name]
			: [];
	});
	return [...new Set(names)]
		.slice(0, MAX_CREATOR_INSTITUTIONS)
		.map((display_name) => ({ display_name }));
}

function creators(work: OpenAlexWork, creatorType: string) {
	return (work.authorships ?? []).flatMap((authorship) => {
		const name = authorName(authorship);
		if (!name) return [];
		return [
			{
				creatorType,
				name,
				institutions: creatorInstitutions(authorship),
			},
		];
	});
}

function metadata(work: OpenAlexWork) {
	const itemType = itemTypeFor(work);
	const zoteroType = canonicalItemTypeToZotero(itemType);
	const fields = describeZoteroItemTypeFields(zoteroType);
	const allowedFields = new Set(
		fields.map(({ semanticField }) => semanticField),
	);
	const doi = normalizeDoi(work.doi) ?? normalizeDoi(work.ids?.doi);
	const candidates: Record<string, string | null> = {
		title: text(work.title) ?? text(work.display_name),
		abstractNote: abstract(work),
		DOI: doi,
		date: publicationDate(work),
		language: text(work.language),
		url: landingUrl(work, doi),
		...sourceFields(
			itemType,
			work.primary_location?.source,
			fields.some(({ field }) => field === "publisher"),
		),
		...biblioFields(work.biblio),
		...medicalIds(work.ids),
	};
	const payload = jsonObjectSchema.parse(
		validateNativeItemDraft(
			{
				itemType,
				...Object.fromEntries(
					Object.entries(candidates).filter(
						([field, value]) =>
							value !== null && allowedFields.has(field),
					),
				),
				creators: creators(work, primaryCreatorType(zoteroType)),
				tags: work.is_retracted ? ["Retracted"] : [],
			},
			sourceRecordValidationOptions,
		).payload,
	);
	delete payload.collections;
	delete payload.parentItem;
	return payload;
}

function hasIncompleteAffiliations({ institutions }: Authorship) {
	return (
		(institutions?.length ?? 0) > MAX_CREATOR_INSTITUTIONS ||
		institutions?.some(
			({ display_name }) =>
				(text(display_name)?.length ?? 0) >
				MAX_CREATOR_INSTITUTION_NAME_LENGTH,
		)
	);
}

function authorshipIssue(authorships: Authorship[]) {
	const messages = [
		authorships.some(hasIncompleteAffiliations)
			? "Affiliations exceeded the editor limits; omitted values remain in the source record."
			: null,
		authorships.length >= 100
			? "OpenAlex returned at least 100 authorships; the author list may be incomplete."
			: null,
		authorships.some((authorship) => !authorName(authorship))
			? "Authorships without a name were omitted from creators and preserved in the source record."
			: null,
	].filter(Boolean);
	return messages.length
		? { code: "incomplete_authorships", message: messages.join(" ") }
		: null;
}

function citationMetric(work: OpenAlexWork) {
	if (work.cited_by_count == null && work.referenced_works_count == null)
		return null;
	return {
		citedByCount: work.cited_by_count ?? null,
		referencedWorksCount: work.referenced_works_count ?? null,
	};
}

function pdfAttachment(
	work: OpenAlexWork,
	parent: SourceItemUpsert,
): SourceItemUpsert | null {
	const pdf = preferredPdf(work);
	if (!pdf) return null;
	const sourceRecordKey = parent.sourceRecordKey;
	return {
		...parent,
		sourceRecordKey: `${sourceRecordKey}:pdf`,
		raw: jsonObjectSchema.parse({
			openalexWorkId: work.id,
			location: pdf,
		}),
		metadata: {
			itemType: "Attachment",
			title: `${sourceRecordKey}.pdf`,
			url: httpUrl(pdf.pdf_url)!,
			// The public site shows a PDF without a cover only when it has this tag.
			tags: ["_auto-process"],
		},
		parentSourceRecordKey: sourceRecordKey,
		aliases: [],
		citationMetric: null,
		referencedSourceRecordKeys: [],
		processingIssue: null,
		file: {
			url: httpUrl(pdf.pdf_url)!,
			contentType: "application/pdf",
			filename: `${sourceRecordKey}.pdf`,
			linkMode: "linked_url",
			md5: null,
			mtime: null,
			charset: null,
			fullText: null,
			coverUrl: null,
			coverWidth: null,
			coverHeight: null,
			managedPublication: null,
		},
	};
}

function institutionFact(institution: Institution): InstitutionFact | null {
	const name = text(institution.display_name);
	const countryCode = text(institution.country_code)?.toUpperCase();
	if (
		!name ||
		name.length > 500 ||
		!countryCode ||
		!Object.hasOwn(countryFocusNames, countryCode)
	)
		return null;
	const openalexId =
		institution.id?.match(
			/^(?:https?:\/\/openalex\.org\/)?(I\d+)$/u,
		)?.[1] ?? null;
	return { name, countryCode, openalexId, city: null };
}

function institutionFacts(authorships: Authorship[]) {
	const institutions = new Map<string, InstitutionFact>();
	for (const institution of authorships.flatMap(
		(authorship) => authorship.institutions ?? [],
	)) {
		const fact = institutionFact(institution);
		if (!fact) continue;
		const key = institutionNameKey(fact.name);
		if (!institutions.has(key)) institutions.set(key, fact);
	}
	return [...institutions.values()];
}

export function mapOpenAlexWork(input: unknown): {
	items: SourceItemUpsert[];
	institutions: InstitutionFact[];
} {
	const raw = jsonObjectSchema.parse(input);
	const work = openAlexWorkSchema.parse(raw);
	const sourceRecordKey = work.id.split("/").pop()!;
	const authorships = work.authorships ?? [];
	const parent: SourceItemUpsert = {
		operation: "upsert",
		sourceRecordKey,
		remoteVersion: date(work.updated_date)?.toISOString() ?? null,
		raw,
		metadata: metadata(work),
		parentSourceRecordKey: null,
		collections: [],
		aliases: [
			{
				key: `https://openalex.org/${sourceRecordKey}`,
				kind: "openalex-uri",
			},
		],
		citationMetric: citationMetric(work),
		referencedSourceRecordKeys: [
			...new Set(
				(work.referenced_works ?? []).map((id) => id.split("/").pop()!),
			),
		],
		file: null,
		processingIssue: authorshipIssue(authorships),
		sourceDates: {
			addedAt: date(work.created_date),
			modifiedAt: date(work.updated_date),
		},
	};
	const attachment = pdfAttachment(work, parent);
	return {
		items: attachment ? [parent, attachment] : [parent],
		institutions: institutionFacts(authorships),
	};
}
