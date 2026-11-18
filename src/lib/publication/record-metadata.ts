import {
	jsonValueSchema,
	type JsonObject,
	type PublicationCreator,
	type PublicationMetadata,
} from "@opendeved/doi-sync-core/metadata";
import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";
import { languageTag } from "@/lib/languages";
import { publicationLicence, type RecordLicence } from "@/lib/licences";
import { studyType } from "@/lib/readings/study-types";
import { institutionNameKey } from "@/config/library-config/institutions";
import type { PublicationRecordExtras } from "./record-extras";
type EvidenceLibraryCreator = {
	creatorType: string;
	firstName?: string | null;
	lastName?: string | null;
	name?: string | null;
	institution?: string | null;
	institutions?: readonly {
		id?: string | null;
		country_code?: string | null;
		display_name?: string | null;
	}[];
};

export type EvidenceLibraryPublicationMetadata = Readonly<
	Record<string, unknown>
> & {
	itemType: string;
	title: string | null;
	date: string | null;
	abstractNote: string | null;
	languageName: string | null;
	publisher: string | null;
	rights: string | null;
	creators: EvidenceLibraryCreator[] | null;
	numPages?: string | null;
	countryFocus?: string[] | null;
	studyType?: string | null;
	/** The licence the record's DOI goes out under; null when none was chosen. */
	licence?: RecordLicence | null;
	/** When the record was withdrawn, for a record with a real DOI that left the community. */
	withdrawnAt?: Date | null;
};

const PRIVATE_TAGS = new Set([
	"doi_active",
	"fix_metadata",
	"internal",
	"no_custom_doi",
	"publication",
]);

const TOP_LEVEL_PUBLICATION_FIELDS = new Set([
	"abstractNote",
	"creators",
	"date",
	"language",
	"publisher",
	"rights",
	"title",
]);

function normalizeText(value: string | null | undefined) {
	const normalized = value?.replace(/\s+/gu, " ").trim();
	return normalized || null;
}

function normalizeCreators(
	creators: readonly EvidenceLibraryCreator[],
	institutions: PublicationRecordExtras["institutions"],
): readonly PublicationCreator[] {
	return creators.map((creator, index) => {
		const givenName = normalizeText(creator.firstName);
		const familyName = normalizeText(creator.lastName);
		const organizationName = normalizeText(
			creator.name ?? creator.institution,
		);
		const common = creatorMetadata(creator, institutions);

		if (givenName && !familyName) {
			throw new Error(`Creator ${index + 1} needs a family name`);
		}
		if (familyName) {
			return {
				type: "personal" as const,
				name: [familyName, givenName].filter(Boolean).join(", "),
				...common,
				...(givenName ? { givenName } : {}),
				familyName,
			};
		}
		if (!organizationName) {
			throw new Error(
				`Creator ${index + 1} needs a personal or organization name`,
			);
		}
		return {
			type: "organizational" as const,
			name: organizationName,
			...common,
		};
	});
}

function normalizePublicationDate(value: string | null) {
	const normalized = normalizeText(value) ?? "";
	const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/u.exec(normalized);
	return match
		? `${match[1]}-${(match[2] ?? "1").padStart(2, "0")}-${(match[3] ?? "1").padStart(2, "0")}`
		: normalized;
}

/** The tags a reader may see: no workflow tags such as "internal", "_r:doi" or any other with "_" or ":". */
export function publicTags(tags: readonly string[]) {
	return [
		...new Set(
			tags.map(normalizeText).filter((tag): tag is string => {
				if (!tag || tag.startsWith("_") || tag.includes(":"))
					return false;
				return !PRIVATE_TAGS.has(tag.toLowerCase());
			}),
		),
	].sort();
}

function providerFields(
	record: EvidenceLibraryPublicationMetadata,
): JsonObject {
	const fields: Record<string, JsonObject[string]> = {};
	const zoteroItemType =
		record.itemType[0]!.toLowerCase() + record.itemType.slice(1);
	for (const descriptor of describeZoteroItemTypeFields(zoteroItemType)) {
		if (TOP_LEVEL_PUBLICATION_FIELDS.has(descriptor.semanticField))
			continue;
		const value = record[descriptor.semanticField];
		if (value === undefined || value === null) continue;
		const parsed = jsonValueSchema.safeParse(value);
		if (parsed.success) {
			fields[
				descriptor.field === "versionNumber"
					? "version"
					: descriptor.field
			] = parsed.data;
		}
	}
	return fields;
}

function recordInstitution(record: EvidenceLibraryPublicationMetadata) {
	const zoteroItemType =
		record.itemType[0]!.toLowerCase() + record.itemType.slice(1);
	// The database projection migration uses the same schema-derived set of
	// item types when it reads the shared publisher column.
	const field = describeZoteroItemTypeFields(zoteroItemType).find(
		(descriptor) => descriptor.semanticField === "publisher",
	)?.field;
	return field === "institution" || field === "university"
		? normalizeText(record.publisher)
		: null;
}

export function publicationRecordMetadata(
	record: EvidenceLibraryPublicationMetadata,
	tags: readonly string[],
	licence: RecordLicence | null,
	extras?: PublicationRecordExtras,
): PublicationMetadata & { fields: JsonObject } {
	const optional = {
		abstract: normalizeText(record.abstractNote),
		// A language written out goes as its code ("English" is "en"). A code stays the code it is, so a record already
		// registered reads the same as before, and text that names no language goes as it is for the provider to refuse.
		language: normalizeText(languageTag(record.languageName?.trim() ?? "") || record.languageName),
		publisher: normalizeText(record.publisher),
		institution: recordInstitution(record),
		rights: normalizeText(record.rights),
	};
	// A withdrawn record keeps its DOI and is registered again saying so, as Crossref asks of withdrawn work: its title
	// starts "WITHDRAWN: " and it carries the day, which takes Crossref's full-text links away and gives Zenodo a
	// withdrawn date (doi-sync-core). Openscholar Reports do the same (openalex-count lib/reports/registration-record.ts).
	const title = normalizeText(record.title) ?? "";
	const withdrawnOn = record.withdrawnAt ? record.withdrawnAt.toISOString().slice(0, 10) : null;
	return {
		itemType: record.itemType,
		title: withdrawnOn ? `WITHDRAWN: ${title}` : title,
		...(withdrawnOn ? { withdrawnOn } : {}),
		publicationDate: normalizePublicationDate(record.date),
		creators: normalizeCreators(record.creators ?? [], extras?.institutions ?? {}),
		tags: publicTags(tags),
		fields: providerFields(record),
		...extraMetadata(record, extras),
		...(licence ? publicationLicence(licence) : {}),
		...Object.fromEntries(
			Object.entries(optional).filter(
				(entry): entry is [string, string] => Boolean(entry[1]),
			),
		),
	};
}

/** A creator's role and every institution it names, each with its ROR and country where known. */
function creatorMetadata(creator: EvidenceLibraryCreator, institutions: PublicationRecordExtras["institutions"]) {
	const creatorType = normalizeText(creator.creatorType);
	const affiliation = (name: string, ownCountry?: string | null) => {
		const known = institutions[institutionNameKey(name)];
		const ror = rorKey(known?.ror);
		const country = (normalizeText(ownCountry) ?? known?.country)?.toUpperCase();
		return { name, ...(ror ? { ror } : {}), ...(country && /^[A-Z]{2}$/u.test(country) ? { country } : {}) };
	};
	const affiliations = (creator.institutions ?? []).flatMap((institution) => {
		const name = normalizeText(institution.display_name);
		return name ? [affiliation(name, institution.country_code)] : [];
	});
	const typed = normalizeText(creator.institution);
	if (!affiliations.length && typed) affiliations.push(affiliation(typed));
	return {
		...(creatorType ? { creatorType } : {}),
		...(affiliations.length ? { affiliations } : {}),
	};
}

/** A ROR ID as the registrars take it: its nine characters, however OpenAlex wrote it. */
const rorKey = (value: string | undefined) => value?.trim().replace(/^https?:\/\/ror\.org\//iu, "").toLowerCase().match(/^0[a-z0-9]{6}\d{2}$/u)?.[0];

/** Places in English, which both registrars read: a country's name, or a region's ("eastern_africa": "Eastern Africa"). */
const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });
const placeOf = (code: string) =>
	/^[A-Z]{2}$/u.test(code) ? { place: COUNTRY.of(code) ?? code, country: code } : { place: code.replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase()) };

/** A list with something in it, or nothing. */
const filled = <T,>(list: readonly T[] | null | undefined) => (list?.length ? [...list] : undefined);

/** The DOIs of the records this one links to in one way. */
const linkedDois = (extras: PublicationRecordExtras | undefined, kind: "cites" | "related") =>
	(extras?.links ?? []).flatMap((link) => (link.kind === kind && link.doi ? [link.doi] : []));

/** The study type in words, as readers see it: an editor's choice, else what was read from the record. */
const designOf = (record: EvidenceLibraryPublicationMetadata, extras: PublicationRecordExtras | undefined) =>
	studyType(extras?.studyType ?? record.studyType ?? "")?.label;

/** The places the record is about, as readers see them: an editor's choice, else what was found in its text. */
const placesOf = (record: EvidenceLibraryPublicationMetadata, extras: PublicationRecordExtras | undefined) =>
	filled((extras?.countries ?? record.countryFocus)?.map(placeOf));

/** How many pages the record runs to, when it says. */
function pageCount(record: EvidenceLibraryPublicationMetadata) {
	const pages = Number(normalizeText(record.numPages));
	return Number.isSafeInteger(pages) && pages > 0 ? pages : undefined;
}

/** What a record holds beyond its basic fields, for registrars that take it: subjects, places, design, pages, links, its file. */
function extraMetadata(record: EvidenceLibraryPublicationMetadata, extras: PublicationRecordExtras | undefined): Partial<PublicationMetadata> {
	const fields = {
		subjects: filled(extras?.topicNames),
		methods: designOf(record, extras),
		locations: placesOf(record, extras),
		pages: pageCount(record),
		formats: filled(extras?.formats),
		fullTextUrl: extras?.fullTextUrl,
		references: filled(linkedDois(extras, "cites")),
		relations: filled(linkedDois(extras, "related").map((identifier) => ({ type: "isRelatedMaterial" as const, identifierType: "doi" as const, identifier }))),
	};
	return Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== undefined));
}
