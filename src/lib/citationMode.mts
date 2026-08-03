import {
	buildDoiDisplayLinks,
	type DoiDisplayLink,
} from "@opendeved/doi-sync-core/display";
import { CITATION_DOI_ONLY_TAG } from "@/constants/citationMode.mts";
import { hasTag } from "./tagMatching.mts";

export type CitationModeItem = {
	DOI?: string | null;
	extra?: string | null;
	tags?: readonly string[] | null;
};

export type CitationDisplayMode =
	| { mode: "citation" }
	| { mode: "doi-only"; link: DoiDisplayLink | null };

export function resolveCitationDisplayMode(
	item: CitationModeItem | null | undefined,
): CitationDisplayMode {
	if (!item || !hasTag(item.tags, CITATION_DOI_ONLY_TAG)) {
		return { mode: "citation" };
	}

	const link = buildDoiDisplayLinks({
		DOI: item.DOI,
		extra: item.extra,
	}).links.find((candidate) => candidate.kind === "doi");

	return { mode: "doi-only", link: link ?? null };
}
