import type { SourceProvider } from "@opendeved/evidence-library-core";

/**
 * Providers whose records are OpenAlex works, keyed by their OpenAlex id. A
 * library keeps one record per work across all of them, with OpenAlex's
 * topics, affiliations, citations and PDFs, and none of them writes back.
 * OpenScholar collections and added papers resolve every item through OpenAlex.
 *
 * ponytail: a provider-wide rule; once OpenScholar resolves items elsewhere
 * too, record on each source link which resolver produced it.
 */
export const OPENALEX_WORK_PROVIDERS = ["openalex", "openscholar", "added"] as const satisfies readonly SourceProvider[];

export function isOpenAlexWorkProvider(provider: string | null | undefined) {
	return (OPENALEX_WORK_PROVIDERS as readonly (string | null | undefined)[]).includes(provider);
}
