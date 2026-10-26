/**
 * Copies a library's old-key redirects from Meilisearch's `redirects` index into PostgreSQL
 * (OpenDevEd/new-el#716), for `npm run search:copy-redirects`. Running it again changes nothing.
 *
 * One `redirects` index can hold several libraries' redirects. A document's id spells
 * `<search index name>|<old key>` as base-36 character codes joined by `n`, and its `value` is the current key.
 * Some codes contain an `n` themselves (`_` is `2n`), so an id can't be split back into text. The copy instead
 * matches the library's own encoded prefix and decodes only the key after it, whose letters and digits never do.
 */
import { sql } from "drizzle-orm";
import { type Meilisearch, MeilisearchApiError } from "meilisearch";

import type { Database } from "@/db/database-schema";
import { itemRedirect } from "@/db/schema/tables/itemRedirect";

const PAGE_SIZE = 1_000;

type RedirectCopySummary = {
	indexFound: boolean;
	read: number;
	copied: number;
	otherLibraries: number;
	unreadable: number;
};

/** The id the old runtime gave a redirect document. */
export function encodeRedirectId(text: string) {
	return text
		.split("")
		.map((char) => char.charCodeAt(0).toString(36))
		.join("n");
}

/** The record key an id spells after the library's prefix, or null when it spells something else. */
function decodeRedirectKey(encoded: string): string | null {
	if (!/^[0-9a-mo-z]+(?:n[0-9a-mo-z]+)*$/.test(encoded)) return null;
	const key = String.fromCharCode(...encoded.split("n").map((code) => Number.parseInt(code, 36)));
	return /^[A-Z0-9]{8}$/.test(key) ? key : null;
}

/** Splits one page of redirect documents into this library's redirects and the documents it leaves alone. */
function redirectsForIndex(documents: readonly { id?: unknown; value?: unknown }[], indexName: string) {
	const prefix = `${encodeRedirectId(`${indexName}|`)}n`;
	const redirects: { fromKey: string; toKey: string }[] = [];
	let otherLibraries = 0;
	let unreadable = 0;
	for (const document of documents) {
		if (typeof document.id !== "string" || !document.id.startsWith(prefix)) {
			otherLibraries += 1;
			continue;
		}
		const fromKey = decodeRedirectKey(document.id.slice(prefix.length));
		if (fromKey === null || typeof document.value !== "string" || !document.value) {
			unreadable += 1;
		} else {
			redirects.push({ fromKey, toKey: document.value });
		}
	}
	return { redirects, otherLibraries, unreadable };
}

export async function copyMeilisearchRedirects(
	client: Meilisearch,
	database: Database,
	indexName: string,
): Promise<RedirectCopySummary> {
	const summary: RedirectCopySummary = { indexFound: true, read: 0, copied: 0, otherLibraries: 0, unreadable: 0 };
	const index = client.index("redirects");
	for (let offset = 0; ; offset += PAGE_SIZE) {
		let page;
		try {
			page = await index.getDocuments<{ id?: unknown; value?: unknown }>({ offset, limit: PAGE_SIZE });
		} catch (error) {
			if (offset === 0 && error instanceof MeilisearchApiError && error.cause?.code === "index_not_found") {
				return { ...summary, indexFound: false };
			}
			throw error;
		}
		const { redirects, otherLibraries, unreadable } = redirectsForIndex(page.results, indexName);
		if (redirects.length) {
			await database
				.insert(itemRedirect)
				.values(redirects)
				.onConflictDoUpdate({ target: itemRedirect.fromKey, set: { toKey: sql`excluded."toKey"` } });
		}
		summary.read += page.results.length;
		summary.copied += redirects.length;
		summary.otherLibraries += otherLibraries;
		summary.unreadable += unreadable;
		if (page.results.length < PAGE_SIZE) return summary;
	}
}
