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
	environment: "sandbox";
	zenodoRecordId: string | null;
	zenodoParentId: string | null;
};

const ZENODO_BASE_URL = {
	sandbox: "https://sandbox.zenodo.org",
} as const;

export function buildPublicationIdentifierSummary(input: {
	identifiers: readonly PublicPublicationIdentifierRow[];
	zenodoState: PublicZenodoStateRow | null;
}): PublicationIdentifierSummary | undefined {
	const crossref = input.identifiers.find(
		(identifier) =>
			identifier.registrar === "crossref" && identifier.role === "primary",
	);
	const zenodoVersion = input.identifiers.find(
		(identifier) =>
			identifier.registrar === "zenodo" &&
			identifier.role === "version" &&
			identifier.ownership === "managed",
	);
	const zenodoConcept = input.identifiers.find(
		(identifier) =>
			identifier.registrar === "zenodo" &&
			identifier.role === "concept" &&
			identifier.ownership === "managed",
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
