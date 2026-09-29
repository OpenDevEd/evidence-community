import { z } from "zod";

import { postToOpenScholar, type OpenScholarService } from "@/lib/openscholar-service";

/** OpenScholar no longer lets the library read this collection. */
export class OpenScholarCollectionGoneError extends Error {
	constructor(
		readonly code: "owner_left" | "not_found",
		collectionId: string,
	) {
		super(
			code === "owner_left"
				? `The person who added OpenScholar collection ${collectionId} left the organisation`
				: `OpenScholar collection ${collectionId} no longer exists`,
		);
		this.name = "OpenScholarCollectionGoneError";
	}
}

export const COLLECTION_ITEMS_PATH = "/api/v1/evidence-libraries/source-collections/items";

/** A collection page from OpenScholar. With `knownVersion` unchanged, it holds no items. */
const collectionPageSchema = z.object({
	contractVersion: z.literal(1),
	version: z.string().min(1).max(128),
	// Shortened to what a source name holds; OpenScholar sends names of any length.
	name: z.string().transform((name) => name.slice(0, 255)),
	unchanged: z.boolean().default(false),
	items: z
		.array(
			z.object({
				itemId: z.string().min(1).max(128),
				openalexId: z.string().regex(/^W\d+$/u).nullable(),
				doi: z.string().max(512).nullable(),
			}),
		)
		.max(1_000)
		.default([]),
	nextCursor: z.string().min(1).max(512).nullable().default(null),
});

export type OpenScholarCollection =
	| { unchanged: true; version: string; name: string }
	| {
			unchanged: false;
			version: string;
			name: string;
			/** The collection's OpenAlex works, sorted, each once. */
			openAlexIds: string[];
			/** Items with no identifier the library can resolve yet. */
			unresolved: number;
	  };

/** Reads that found the collection changing between pages before one read it whole. */
const MAX_READS = 3;

/**
 * Reads an OpenScholar collection's items. A collection still at
 * `knownVersion` answers without them. The pages must share one version, so
 * a collection edited mid-read is read again.
 */
export async function readOpenScholarCollection(
	service: OpenScholarService,
	collectionId: string,
	knownVersion: string | null,
	options: { fetch?: typeof fetch } = {},
): Promise<OpenScholarCollection> {
	const page = async (cursor: string | null, known: string | null) =>
		collectionPageSchema.parse(
			await postToOpenScholar(
				service,
				COLLECTION_ITEMS_PATH,
				{ contractVersion: 1, collectionId, cursor, knownVersion: known },
				{ fetch: options.fetch, timeoutMs: 30_000, maxBytes: 4_000_000 },
			),
		);
	for (let read = 0; read < MAX_READS; read++) {
		const first = await page(null, knownVersion);
		if (first.unchanged) return { unchanged: true, version: first.version, name: first.name };
		const items = [...first.items];
		let next = first.nextCursor;
		let consistent = true;
		while (next && consistent) {
			const more = await page(next, null);
			consistent = more.version === first.version;
			items.push(...more.items);
			next = more.nextCursor;
		}
		if (!consistent) continue;
		const ids = items.flatMap((item) => (item.openalexId ? [item.openalexId] : []));
		return {
			unchanged: false,
			version: first.version,
			name: first.name,
			openAlexIds: [...new Set(ids)].sort(),
			unresolved: items.length - ids.length,
		};
	}
	throw new Error(`OpenScholar collection ${collectionId} kept changing while it was read`);
}
