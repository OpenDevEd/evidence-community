import { createHmac } from "node:crypto";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { buildSiteUrl } from "@/lib/site-url";

type IndexNowConfig = Pick<LibraryServerConfig, "authentication" | "generation" | "identity">;

const ENDPOINT = "https://api.indexnow.org/indexnow";
/** Where the community serves its key, at the root so it speaks for every address. */
const KEY_PATH = "/indexnow-key.txt";
/** The most addresses IndexNow takes in one request. */
const BATCH = 10_000;
/** The most addresses kept while a request is out. A change that queues more than this is a whole-library one, which the sitemap covers. */
const MAX_WAITING = 100_000;
/** At least this long between requests, so a busy import sends a few large lists, not one per batch of records. */
const PAUSE_MS = 5_000;
const TIMEOUT_MS = 10_000;

/**
 * The community's IndexNow key (indexnow.org): the search engine reads it from the community's own address, which
 * proves a list of changed pages comes from that community. It is public by design. Made from the community's own
 * secret, so nothing new is stored and no two communities share one.
 */
export function indexNowKey(config: Pick<LibraryServerConfig, "authentication">) {
	return createHmac("sha256", config.authentication.secret).update("indexnow").digest("hex").slice(0, 32);
}

/**
 * Tells Bing and the other IndexNow search engines which records' pages are new, changed or gone, so they read them
 * now and not at their next crawl. Null for a community that has it off.
 *
 * `add` never waits and never throws: the search indexer calls it between batches, and a slow or failing search engine
 * must not slow indexing. One request is out at a time; records that change meanwhile wait for the next one. A list
 * that fails is dropped, because the sitemap still names every record.
 */
export function createIndexNowNotifier(
	config: IndexNowConfig,
	{ fetcher = fetch, pauseMs = PAUSE_MS, log = console.error, say = console.log }: { fetcher?: typeof fetch; pauseMs?: number; log?: (message: string) => void; say?: (message: string) => void } = {},
) {
	if (!config.generation.indexNow) return null;
	const { baseUrl } = config.identity;
	const key = indexNowKey(config);
	const waiting = new Set<string>();
	let sending: Promise<void> | null = null;

	async function send() {
		while (waiting.size > 0) {
			const keys = [...waiting].slice(0, BATCH);
			for (const sent of keys) waiting.delete(sent);
			try {
				const response = await fetcher(ENDPOINT, {
					method: "POST",
					headers: { "Content-Type": "application/json; charset=utf-8" },
					body: JSON.stringify({
						host: new URL(baseUrl).host,
						key,
						keyLocation: buildSiteUrl(KEY_PATH, baseUrl),
						urlList: keys.map((recordKey) => buildSiteUrl(`/lib/${recordKey}`, baseUrl)),
					}),
					signal: AbortSignal.timeout(TIMEOUT_MS),
				});
				// 200 is taken, 202 is taken with the key still to be checked.
				if (response.ok) say(`IndexNow took ${keys.length} addresses (${response.status})`);
				else log(`IndexNow refused ${keys.length} addresses: ${response.status} ${(await response.text()).slice(0, 200)}`);
			} catch (error) {
				log(`IndexNow could not be reached for ${keys.length} addresses: ${error instanceof Error ? error.message : error}`);
			}
			// Not held open for: a worker that is stopping drops what is left.
			await new Promise<void>((resolve) => setTimeout(resolve, pauseMs).unref());
		}
	}

	return {
		add(recordKeys: readonly string[]) {
			for (const recordKey of recordKeys) {
				if (waiting.size >= MAX_WAITING) break;
				waiting.add(recordKey);
			}
			sending ??= send().finally(() => {
				sending = null;
			});
		},
		/** Resolves once nothing is waiting or out. For tests. */
		idle: () => sending ?? Promise.resolve(),
	};
}
