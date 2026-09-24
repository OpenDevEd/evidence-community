import {
	buildDoiDisplayLinks,
	type DoiDisplayLinks,
} from "@opendeved/doi-sync-core/display";
import { normalizeDoi } from "@/lib/doi";

import {
	isZenodoDoi,
	resolveBibliographicDoi,
	type BibliographicDoiInput,
	type BibliographicDoiResolution,
} from "./bibliographic-doi";

export type PublicationIdentifierSummary = {
	crossref?: {
		doi: string;
		lifecycle: "reserved" | "verified";
	} | null;
	zenodo?: {
		versionDoi?: string | null;
		conceptDoi?: string | null;
		recordId?: string | null;
		conceptRecordId?: string | null;
		baseUrl?: string | null;
	} | null;
};

export type PublicationDisplayInput = BibliographicDoiInput & {
	publicationIdentifiers?: PublicationIdentifierSummary | null;
};

export type PublicationDisplay = {
	bibliographicDoi: BibliographicDoiResolution;
	links: DoiDisplayLinks;
	managed: boolean;
};

const ZENODO_RECORD_URL_PATTERN =
	/^https?:\/\/(?:sandbox\.)?zenodo\.org\/(?:record|records)\/(\d+)\b/iu;
const ZENODO_RECORD_TAGS = new Set([
	"_r:zenodorecord",
	"_r:zenododeposit",
]);

/** Attachments that feed the DOI and Zenodo links on the item page. */
export function isIdentifierAttachment(attachment: {
	tags?: readonly string[] | null;
}) {
	return Boolean(
		attachment.tags?.some((tag) => {
			const normalized = tag.trim().toLowerCase();
			return normalized === "_r:doi" || ZENODO_RECORD_TAGS.has(normalized);
		}),
	);
}

type ImportedZenodoIdentifiers = {
	versionDoi?: string;
	conceptDoi?: string;
	recordId?: string;
	conceptRecordId?: string;
	baseUrl?: string;
};

function validRecordId(value: string) {
	return /^[1-9]\d*$/u.test(value) ? value : null;
}

function recordIdFromZenodoDoi(doi: string) {
	return isZenodoDoi(doi) ? doi.split(".").at(-1) : null;
}

function maximumRecordId(values: readonly string[]) {
	return values.reduce<string | undefined>((maximum, value) => {
		if (!maximum) return value;
		return BigInt(value) > BigInt(maximum) ? value : maximum;
	}, undefined);
}

function zenodoRecord(value: string | null | undefined) {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	const match = ZENODO_RECORD_URL_PATTERN.exec(trimmed);
	if (!match || !URL.canParse(trimmed)) return null;
	const url = new URL(trimmed);
	return { recordId: match[1], baseUrl: url.origin };
}

function parseImportedZenodoIdentifiers(
	input: BibliographicDoiInput,
): ImportedZenodoIdentifiers {
	const identifiers: ImportedZenodoIdentifiers = {};
	const legacyRecordIds: string[] = [];
	let explicitRecordId: string | undefined;
	let attachmentRecordId: string | undefined;

	const directDoi = normalizeDoi(input.DOI);
	if (directDoi && isZenodoDoi(directDoi)) {
		identifiers.versionDoi = directDoi;
		const recordId = recordIdFromZenodoDoi(directDoi);
		if (recordId) legacyRecordIds.push(recordId);
	}

	for (const line of (input.extra ?? "").split(/\r?\n/u)) {
		const separator = line.indexOf(":");
		if (separator < 0) continue;
		const key = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		if (!value) continue;

		if (key === "archive") {
			const record = zenodoRecord(value);
			if (record) {
				legacyRecordIds.push(record.recordId);
				identifiers.baseUrl = record.baseUrl;
			}
			continue;
		}
		if (key === "zenodoarchiveid") {
			explicitRecordId = validRecordId(value) ?? explicitRecordId;
			continue;
		}
		if (key === "zenodoarchiveconcept") {
			identifiers.conceptRecordId =
				validRecordId(value) ?? identifiers.conceptRecordId;
			continue;
		}

		const doi = normalizeDoi(value);
		if (!doi || !isZenodoDoi(doi)) continue;
		if (
			key === "zenodoversiondoi" ||
			key === "zenododoi" ||
			key === "doi"
		) {
			identifiers.versionDoi ??= doi;
		}
		if (key === "zenodoconceptdoi") identifiers.conceptDoi ??= doi;
		if (key === "doi" || key === "previousdoi") {
			const recordId = recordIdFromZenodoDoi(doi);
			if (recordId) legacyRecordIds.push(recordId);
		}
	}

	for (const attachment of input.attachments ?? []) {
		const tags = new Set(
			(attachment.tags ?? []).map((tag) => tag.trim().toLowerCase()),
		);
		if (tags.has("_r:doi")) {
			const doi = normalizeDoi(attachment.url);
			if (doi && isZenodoDoi(doi)) {
				identifiers.versionDoi ??= doi;
				const recordId = recordIdFromZenodoDoi(doi);
				if (recordId) legacyRecordIds.push(recordId);
			}
		}
		if (![...ZENODO_RECORD_TAGS].some((tag) => tags.has(tag))) continue;
		const record = zenodoRecord(attachment.url);
		if (!record) continue;
		attachmentRecordId ??= record.recordId;
		identifiers.baseUrl ??= record.baseUrl;
	}

	identifiers.recordId =
		explicitRecordId ??
		maximumRecordId(legacyRecordIds) ??
		attachmentRecordId;

	return identifiers;
}

export function buildPublicationDisplay(
	input: PublicationDisplayInput,
): PublicationDisplay {
	const importedZenodo = parseImportedZenodoIdentifiers(input);
	const managedCrossref = input.publicationIdentifiers?.crossref ?? null;
	const managedZenodo = input.publicationIdentifiers?.zenodo ?? null;
	const zenodoVersionDoi =
		managedZenodo?.versionDoi ?? importedZenodo.versionDoi;
	const zenodoConceptDoi =
		managedZenodo?.conceptDoi ?? importedZenodo.conceptDoi;
	const bibliographicDoi = resolveBibliographicDoi(input, {
		ignoredDois: [zenodoVersionDoi, zenodoConceptDoi].filter(
			(value): value is string => Boolean(value),
		),
	});
	const displayBibliographicDoi =
		bibliographicDoi.status === "resolved" &&
		bibliographicDoi.doi !== zenodoVersionDoi
			? bibliographicDoi.doi
			: null;

	return {
		bibliographicDoi,
		links: buildDoiDisplayLinks({
			bibliographicDoi: displayBibliographicDoi,
			crossrefDoi: managedCrossref?.doi,
			zenodoVersionDoi,
			zenodoConceptDoi,
			zenodoRecordId: managedZenodo?.recordId ?? importedZenodo.recordId,
			zenodoConceptRecordId:
				managedZenodo?.conceptRecordId ??
				importedZenodo.conceptRecordId,
			zenodoBaseUrl: managedZenodo?.baseUrl ?? importedZenodo.baseUrl,
		}),
		managed: Boolean(managedCrossref || managedZenodo),
	};
}
