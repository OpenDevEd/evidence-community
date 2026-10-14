import {
	jsonValueSchema,
	type JsonObject,
	type PublicationCreator,
	type PublicationMetadata,
} from "@opendeved/doi-sync-core/metadata";
import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";
type EvidenceLibraryCreator = {
	creatorType: string;
	firstName?: string | null;
	lastName?: string | null;
	name?: string | null;
	institution?: string | null;
	institutions?: readonly {
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
): readonly PublicationCreator[] {
	return creators.map((creator, index) => {
		const givenName = normalizeText(creator.firstName);
		const familyName = normalizeText(creator.lastName);
		const organizationName = normalizeText(
			creator.name ?? creator.institution,
		);
		const common = creatorMetadata(creator);

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
	license: string,
): PublicationMetadata & { fields: JsonObject } {
	const optional = {
		abstract: normalizeText(record.abstractNote),
		language: normalizeText(record.languageName),
		publisher: normalizeText(record.publisher),
		institution: recordInstitution(record),
		rights: normalizeText(record.rights),
		license: normalizeText(license),
	};
	return {
		itemType: record.itemType,
		title: normalizeText(record.title) ?? "",
		publicationDate: normalizePublicationDate(record.date),
		creators: normalizeCreators(record.creators ?? []),
		tags: publicTags(tags),
		fields: providerFields(record),
		...Object.fromEntries(
			Object.entries(optional).filter(
				(entry): entry is [string, string] => Boolean(entry[1]),
			),
		),
	};
}

function creatorMetadata(creator: EvidenceLibraryCreator) {
	const creatorType = normalizeText(creator.creatorType);
	const affiliation = normalizeText(
		creator.institutions?.find((entry) => entry.display_name)
			?.display_name ?? creator.institution,
	);
	return {
		...(creatorType ? { creatorType } : {}),
		...(affiliation ? { affiliation } : {}),
	};
}
