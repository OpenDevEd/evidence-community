import { normalizeDoi } from "@/lib/doi";
import {
	isZenodoDoi,
	resolveBibliographicDoi,
	type BibliographicDoiInput,
} from "./bibliographic-doi";
import type { PublicationIdentifierSummary } from "./publication-display-adapter";

export type PublicPublicationIdentifierRow = {
	registrar: "crossref" | "zenodo";
	role: "primary" | "version" | "concept";
	doi: string;
	lifecycle: "reserved" | "verified";
	/**
	 * `external` marks a DOI the record brought with it that Zenodo merely
	 * archived under (reuse-external). It is the record's DOI, not a Zenodo DOI.
	 */
	ownership: "managed" | "external";
};

export type PublicZenodoStateRow = {
	environment: "sandbox" | "production";
	zenodoRecordId: string | null;
	zenodoParentId: string | null;
};

const ZENODO_BASE_URL = {
	sandbox: "https://sandbox.zenodo.org",
	production: "https://zenodo.org",
} as const;

export function buildPublicationIdentifierSummary(input: {
	identifiers: readonly PublicPublicationIdentifierRow[];
	zenodoState: PublicZenodoStateRow | null;
	bibliographicDoi?: string | null;
}): PublicationIdentifierSummary | undefined {
	// Creator reservations stay private until Editor activation assigns the DOI
	// to the approved record, or the provider confirms it.
	const crossref = input.identifiers.find(
		(identifier) =>
			identifier.registrar === "crossref" &&
			identifier.role === "primary" &&
			(identifier.lifecycle === "verified" ||
				normalizeDoi(identifier.doi) === input.bibliographicDoi),
	);
	const zenodoVersion = input.identifiers.find(
		(identifier) =>
			identifier.registrar === "zenodo" &&
			identifier.role === "version" &&
			identifier.ownership === "managed" &&
			identifier.lifecycle === "verified",
	);
	const zenodoConcept = input.identifiers.find(
		(identifier) =>
			identifier.registrar === "zenodo" &&
			identifier.role === "concept" &&
			identifier.ownership === "managed" &&
			identifier.lifecycle === "verified",
	);
	const hasZenodo = Boolean(
		zenodoVersion ||
			zenodoConcept ||
			input.zenodoState?.zenodoRecordId ||
			input.zenodoState?.zenodoParentId,
	);

	if (!crossref && !hasZenodo) return undefined;

	return {
		...(crossref
			? {
					crossref: {
						doi: crossref.doi,
						lifecycle: crossref.lifecycle,
					},
				}
			: {}),
		...(hasZenodo
			? {
					zenodo: {
						...(zenodoVersion ? { versionDoi: zenodoVersion.doi } : {}),
						...(zenodoConcept ? { conceptDoi: zenodoConcept.doi } : {}),
						...(input.zenodoState?.zenodoRecordId
							? { recordId: input.zenodoState.zenodoRecordId }
							: {}),
						...(input.zenodoState?.zenodoParentId
							? { conceptRecordId: input.zenodoState.zenodoParentId }
							: {}),
						...(input.zenodoState
							? { baseUrl: ZENODO_BASE_URL[input.zenodoState.environment] }
							: {}),
					},
				}
			: {}),
	};
}

/** Prefer the bibliographic DOI, then a confirmed provider DOI. */
export function resolvePublicDoi(
	input: BibliographicDoiInput & {
		publicationIdentifiers?: PublicationIdentifierSummary | null;
	},
) {
	const bibliographic = normalizeDoi(input.DOI)
		?? resolveBibliographicDoi({ extra: input.extra }).doi;
	if (bibliographic && !isZenodoDoi(bibliographic)) return bibliographic;

	const summary = input.publicationIdentifiers;
	const crossref = summary?.crossref?.lifecycle === "verified"
		? normalizeDoi(summary.crossref.doi)
		: null;
	const version = normalizeDoi(summary?.zenodo?.versionDoi);
	const concept = normalizeDoi(summary?.zenodo?.conceptDoi);
	return crossref ?? version ?? (bibliographic === concept ? null : bibliographic);
}
