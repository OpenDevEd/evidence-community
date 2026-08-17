import {
	jsonValueSchema,
	parsePublicationFileManifest,
	parsePublicationIdentifiers,
	parsePublicationRecordSnapshot,
	type JsonObject,
	type PublicationCreator,
	type PublicationFileManifest,
	type PublicationIdentifiers,
	type PublicationRecordSnapshot,
} from "@opendeved/doi-sync-core";
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

export type EvidenceLibraryPublicationRecord = Readonly<
	Record<string, unknown>
> & {
	key: string;
	revision: number;
	itemType: string;
	title: string | null;
	date: string | null;
	abstractNote: string | null;
	languageName: string | null;
	publisher: string | null;
	rights: string | null;
	creators: EvidenceLibraryCreator[] | null;
	createdAt: Date;
	dateAdded: Date | null;
};

export type EvidenceLibraryPublishedFile = {
	itemKey: string;
	revision: number;
	filename: string;
	contentType: string;
	sizeBytes: number;
	sha256: string;
	md5: string;
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
		const creatorType = normalizeText(creator.creatorType);
		const affiliation = normalizeText(
			creator.institutions?.find((entry) => entry.display_name)?.display_name ??
				creator.institution,
		);

		if (givenName && !familyName) {
			throw new Error(`Creator ${index + 1} needs a family name`);
		}
		if (familyName) {
			return {
				type: "personal" as const,
				name: [familyName, givenName].filter(Boolean).join(", "),
				...(creatorType ? { creatorType } : {}),
				...(givenName ? { givenName } : {}),
				familyName,
				...(affiliation ? { affiliation } : {}),
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
			...(creatorType ? { creatorType } : {}),
			...(affiliation ? { affiliation } : {}),
		};
	});
}

function normalizePublicationDate(value: string | null, fallback: Date) {
	const normalized = normalizeText(value);
	const match = normalized?.match(/\b(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?\b/u);
	if (!match?.[1]) return fallback.toISOString().slice(0, 10);
	const month = (match[2] ?? "1").padStart(2, "0");
	const day = (match[3] ?? "1").padStart(2, "0");
	const candidate = `${match[1]}-${month}-${day}`;
	const parsed = new Date(`${candidate}T00:00:00Z`);
	return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate
		? fallback.toISOString().slice(0, 10)
		: candidate;
}

function publicTags(tags: readonly string[]) {
	return [...new Set(tags.map(normalizeText).filter((tag): tag is string => {
		if (!tag || tag.startsWith("_") || tag.includes(":")) return false;
		return !PRIVATE_TAGS.has(tag.toLowerCase());
	}))].sort();
}

function providerFields(record: EvidenceLibraryPublicationRecord): JsonObject {
	const fields: Record<string, JsonObject[string]> = {};
	const zoteroItemType =
		record.itemType[0]!.toLowerCase() + record.itemType.slice(1);
	for (const descriptor of describeZoteroItemTypeFields(zoteroItemType)) {
		if (TOP_LEVEL_PUBLICATION_FIELDS.has(descriptor.semanticField)) continue;
		const value = record[descriptor.semanticField];
		if (value === undefined || value === null) continue;
		const parsed = jsonValueSchema.safeParse(value);
		if (parsed.success) {
			fields[descriptor.field === "versionNumber" ? "version" : descriptor.field] =
				parsed.data;
		}
	}
	return fields;
}

export function buildPublicationRecordSnapshot(input: {
	record: EvidenceLibraryPublicationRecord;
	tags: readonly string[];
	baseUrl: string;
	license: string;
}): PublicationRecordSnapshot {
	const title = normalizeText(input.record.title);
	if (!title) throw new Error("Add a title before activating publication");
	return buildPublicationRecordSnapshotWithTitle(input, title);
}

function buildPublicationRecordSnapshotWithTitle(
	input: {
		record: EvidenceLibraryPublicationRecord;
		tags: readonly string[];
		baseUrl: string;
		license: string;
	},
	title: string,
): PublicationRecordSnapshot {

	const optional = {
		abstract: normalizeText(input.record.abstractNote),
		language: normalizeText(input.record.languageName),
		publisher: normalizeText(input.record.publisher),
		institution: ["Manuscript", "Report", "Standard", "Thesis"].includes(
			input.record.itemType,
		)
			? normalizeText(input.record.publisher)
			: null,
		rights: normalizeText(input.record.rights),
		license: normalizeText(input.license),
	};
	return parsePublicationRecordSnapshot({
		recordKey: input.record.key,
		canonicalRevision: input.record.revision,
		landingUrl: new URL(`/lib/${input.record.key}`, input.baseUrl).toString(),
		itemType: input.record.itemType,
		title,
		publicationDate: normalizePublicationDate(
			input.record.date,
			input.record.dateAdded ?? input.record.createdAt,
		),
		creators: normalizeCreators(input.record.creators ?? []),
		tags: publicTags(input.tags),
		fields: providerFields(input.record),
		...Object.fromEntries(
			Object.entries(optional).filter((entry): entry is [string, string] => Boolean(entry[1])),
		),
	});
}

export function inspectPublicationRecordSnapshot(input: {
	record: EvidenceLibraryPublicationRecord;
	tags: readonly string[];
	baseUrl: string;
	license: string;
}): {
	issues: readonly string[];
	record: PublicationRecordSnapshot;
} {
	const title = normalizeText(input.record.title);
	return {
		issues: title ? [] : ["Add a title before activating publication"],
		record: buildPublicationRecordSnapshotWithTitle(
			input,
			title ?? "Missing title",
		),
	};
}

export function buildPublicationFileManifest(
	files: readonly EvidenceLibraryPublishedFile[],
): PublicationFileManifest {
	return parsePublicationFileManifest({
		files: files.map((file) => ({
			fileKey: file.itemKey,
			publicationRevision: file.revision,
			filename: file.filename,
			contentType: file.contentType,
			size: file.sizeBytes,
			sha256: file.sha256,
		})),
	});
}

export function buildPublicationIdentifiers(input: {
	bibliographicDoi?: string | null;
	managedCrossrefDoi?: string | null;
	zenodoVersionDoi?: string | null;
	zenodoConceptDoi?: string | null;
}): PublicationIdentifiers {
	return parsePublicationIdentifiers(
		Object.fromEntries(
			Object.entries(input).filter((entry): entry is [string, string] => Boolean(entry[1])),
		),
	);
}
