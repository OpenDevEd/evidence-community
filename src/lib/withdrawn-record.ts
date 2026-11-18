import "server-only";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { readPublicIdentifiers } from "@/lib/publication/public-identifiers";
import { buildPublicationDisplay } from "@/lib/publication/publication-display-adapter";

/** What a withdrawn record's tombstone shows: enough to know the work and its DOI, never its abstract or files. */
export type WithdrawnRecord = {
	key: string;
	title: string;
	authors: string[];
	year: string | null;
	withdrawnAt: string;
	reason: string;
	dois: { label: string; value: string; url: string }[];
};

/**
 * A record withdrawn from the community, which its DOI still leads to: a removed record with a real DOI keeps its
 * address, and that address says it was withdrawn, when and why (OpenDevEd/new-el#893). Null for any other key.
 */
export async function readWithdrawnRecord(database: Database, key: string, config: Pick<LibraryServerConfig, "services">): Promise<WithdrawnRecord | null> {
	const [row] = await database
		.select()
		.from(item)
		.where(and(eq(item.key, key), eq(item.deleted, 1), isNotNull(item.withdrawnAt), isNull(item.parentItem)))
		.limit(1);
	if (!row?.withdrawnAt) return null;
	const identifiers = (await readPublicIdentifiers(database, [row], config.services.publication)).get(row.key);
	const links = buildPublicationDisplay({ DOI: row.DOI, extra: row.extra, attachments: [], publicationIdentifiers: identifiers }).links.links;
	return {
		key: row.key,
		title: row.title?.trim() || row.key,
		authors: (row.creators ?? []).filter((creator) => creator.creatorType === "author").map(creatorDisplayName).filter(Boolean),
		year: row.date?.match(/\d{4}/u)?.[0] ?? null,
		withdrawnAt: row.withdrawnAt.toISOString(),
		reason: row.withdrawalReason ?? "",
		dois: links.filter((link) => link.kind !== "record" && link.kind !== "concept-record").map((link) => ({ label: link.label, value: link.value, url: link.url })),
	};
}
