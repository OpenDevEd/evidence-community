import { normalizeDoi } from "@/lib/doi";

export type BibliographicDoiAttachment = {
	url?: string | null;
	tags?: readonly string[] | null;
};

export type BibliographicDoiInput = {
	DOI?: string | null;
	extra?: string | null;
	attachments?: readonly BibliographicDoiAttachment[] | null;
};

export type BibliographicDoiResolutionOptions = {
	ignoredDois?: readonly string[];
};

export type BibliographicDoiConflict = {
	source: string;
	doi: string;
};

export type BibliographicDoiResolution =
	| {
			status: "none";
			doi: null;
			sources: readonly [];
			conflicts: readonly [];
	  }
	| {
			status: "resolved";
			doi: string;
			sources: readonly string[];
			conflicts: readonly [];
	  }
	| {
			status: "conflict";
			doi: null;
			sources: readonly [];
			conflicts: readonly BibliographicDoiConflict[];
	  };

const DOI_ATTACHMENT_TAG = "_r:doi";
const ZENODO_DOI_PATTERN = /^10\.(?:5281|5072)\/zenodo\.\d+$/iu;

export function isZenodoDoi(doi: string) {
	return ZENODO_DOI_PATTERN.test(doi);
}

function extraDoi(extra: string | null | undefined) {
	for (const line of (extra ?? "").split(/\r?\n/u)) {
		const separator = line.indexOf(":");
		if (separator < 0) continue;
		if (line.slice(0, separator).trim().toLowerCase() !== "doi") continue;
		return line.slice(separator + 1).trim();
	}
	return null;
}

export function resolveBibliographicDoi(
	input: BibliographicDoiInput,
	options: BibliographicDoiResolutionOptions = {},
): BibliographicDoiResolution {
	const ignoredDois = new Set(
		(options.ignoredDois ?? []).flatMap((value) => {
			const doi = normalizeDoi(value);
			return doi ? [doi] : [];
		}),
	);
	const candidates = [
		{ source: "item.DOI", value: input.DOI },
		{ source: "item.extra.DOI", value: extraDoi(input.extra) },
		...(input.attachments ?? []).map((attachment, index) => ({
			source: `attachment[${index}]`,
			value: attachment.tags?.some(
				(tag) => tag.trim().toLowerCase() === DOI_ATTACHMENT_TAG,
			)
				? attachment.url
				: null,
		})),
	]
		.map((candidate) => ({
			source: candidate.source,
			doi: normalizeDoi(candidate.value),
		}))
		.filter(
			(candidate): candidate is { source: string; doi: string } =>
				candidate.doi !== null &&
				!ignoredDois.has(candidate.doi),
		);

	if (candidates.length === 0) {
		return { status: "none", doi: null, sources: [], conflicts: [] };
	}

	const dois = new Set(candidates.map((candidate) => candidate.doi));
	if (dois.size > 1) {
		return {
			status: "conflict",
			doi: null,
			sources: [],
			conflicts: candidates,
		};
	}

	return {
		status: "resolved",
		doi: candidates[0].doi,
		sources: candidates.map((candidate) => candidate.source),
		conflicts: [],
	};
}
