import { z } from "zod";

/**
 * Openscholar's own search engine answers OpenAlex's requests, so an OpenAlex source can read it instead. A source
 * chooses it with its API key, written `openscholar-search:<key>:<Access client id>:<Access client secret>`: the engine
 * sits behind Cloudflare Access, so a request carries the service token beside the key.
 */
const KEY_PREFIX = "openscholar-search:";

export const SEARCH_ENGINE_ORIGIN = "https://search-api.openscholar.ai";

export type SearchEngineAccess = { key: string; clientId: string; clientSecret: string };

/** The engine's access in a source's API key; null for an OpenAlex key. A malformed one never goes to OpenAlex. */
export function readSearchEngineAccess(apiKey: string): SearchEngineAccess | null {
	if (!apiKey.startsWith(KEY_PREFIX)) return null;
	const [key, clientId, clientSecret, ...rest] = apiKey.slice(KEY_PREFIX.length).split(":");
	if (!key || !clientId || !clientSecret || rest.length)
		throw new Error("An Openscholar search key is written openscholar-search:<key>:<client id>:<client secret>");
	return { key, clientId, clientSecret };
}

export function searchEngineHeaders({ key, clientId, clientSecret }: SearchEngineAccess) {
	return {
		Authorization: `Bearer ${key}`,
		"CF-Access-Client-Id": clientId,
		"CF-Access-Client-Secret": clientSecret,
	};
}

const namedWorkSchema = z.object({ ids: z.object({ openalex: z.string().regex(/\/W\d+$/u) }).loose() }).loose();

/**
 * A work of the engine as OpenAlex would give it: under OpenAlex's id, which identifies records in a library, and without
 * references, which the engine names by its own ids. Their count stays. Null for a work OpenAlex doesn't hold.
 */
export function asOpenAlexWork(work: unknown) {
	const named = namedWorkSchema.safeParse(work);
	return named.success ? { ...named.data, id: named.data.ids.openalex, referenced_works: [] } : null;
}
