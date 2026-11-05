import { cache } from "react";
import { getDatabase, getDatabaseForConfig } from "@/db";
import { getItem, withoutFullText } from "./item/[key]/route";
import { and, eq, sql } from "drizzle-orm";
import { outbox } from "@opendeved/evidence-library-core";
import { isIndexOnly } from "@/lib/search-index/index-only";
import { readIndexedStatus } from "@/lib/search-index/index-only-read";
import { readPublicLibraryStatus, type PublicLibraryStatus } from "@/lib/library-export-records";
import { getCollections } from "./collections/data";
import { Collection } from "./collections/types";
import { getPublicSources } from "./sources/data";
import { cacheLife, cacheTag } from "next/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RuntimeCollectionConfigurationError } from "@/lib/collections";
import { staleWhileRevalidate } from "@/lib/stale-while-revalidate";
import { withTopicNames } from "@/lib/topics/server";

// --- Collections ---

export type CachedCollectionsResult =
	| {
			ok: true;
			collections: Collection[];
	  }
	| {
			ok: false;
			missingIds: readonly string[];
	  };

async function _getCollectionsCached(
	configRevision: string,
	config: LibraryServerConfig,
): Promise<CachedCollectionsResult> {
	"use cache";
	cacheLife({ revalidate: 300 });
	cacheTag("collections");
	try {
		return {
			ok: true,
			collections: await getCollections(config),
		};
	} catch (error) {
		if (error instanceof RuntimeCollectionConfigurationError) {
			return {
				ok: false,
				missingIds: error.missingIds,
			};
		}

		throw error;
	}
}

export async function getCachedCollectionsResult(config?: LibraryServerConfig) {
	const libraryConfig = config ?? (await getLibraryConfig());
	return _getCollectionsCached(libraryConfig.revision, libraryConfig);
}

export async function getCachedCollections(config?: LibraryServerConfig) {
	const result = await getCachedCollectionsResult(config);
	if (!result.ok) {
		throw new RuntimeCollectionConfigurationError(result.missingIds);
	}

	return result.collections;
}

// --- Sources ---

async function _getSourcesCached(_configRevision: string, config: LibraryServerConfig) {
	"use cache";
	// A Zotero group renamed at Zotero shows within five minutes; a source renamed in the configuration at once.
	cacheLife({ revalidate: 300 });
	cacheTag("sources");
	return getPublicSources(config);
}

export async function getCachedSources(config?: LibraryServerConfig) {
	const libraryConfig = config ?? (await getLibraryConfig());
	return _getSourcesCached(libraryConfig.revision, libraryConfig);
}

// Share the database read within one render, without keeping an older public revision.
export const getCachedItem = cache(getItem);

/**
 * The record's public version. Every public change writes an outbox row for the
 * record (and its parent when a child changes) in the writer's own transaction.
 * Rows are never deleted, and a re-queued row takes a new id (see
 * enqueueItemSearchReprojection), so the sum of ids grows with each committed
 * change, whatever order transactions commit in.
 */
export async function readItemVersion(key: string) {
	const db = await getDatabase();
	const [row] = await db
		.select({ version: sql<string>`coalesce(sum(${outbox.id}), 0)::text` })
		.from(outbox)
		.where(and(eq(outbox.entityType, "item"), eq(outbox.entityKey, key)));
	return row?.version ?? "0";
}

// A new version or config revision is a new key, so a committed change, hide
// included, is read fresh on the next request. Old entries age out of memory.
// "Not found" is kept too. Full text is left out.
async function readCachedPublicItem(key: string, _configRevision: string, _version: string) {
	"use cache";
	cacheLife("max");
	cacheTag(`item:${key}`, "library");
	return withoutFullText(await getItem(key));
}

export const getCachedItemSmall = cache(async (key: string) => {
	const config = await getLibraryConfig();
	// Nothing tells an index-only library's cache that a load replaced a record, and reading the index is quick.
	if (isIndexOnly(config)) return withoutFullText(await getItem(key));
	return readCachedPublicItem(key, config.revision, await readItemVersion(key));
});

/** A record as its page draws it: a placeholder until its citation is read, and its stored topic names. */
export async function getCachedItemPage(key: string) {
	const data = await getCachedItemSmall(key);
	if (data.item && !data.item.citation) data.item.citation = "<div>Loading...</div>";
	return withTopicNames(data);
}

/**
 * The library's public record count and last update, which every page's layout reads. Counting a large library takes
 * about a second, so the last count answers at once and a fresh one is taken behind it after a minute.
 */
export async function getCachedStatus(): Promise<PublicLibraryStatus> {
	const config = await getLibraryConfig();
	return staleWhileRevalidate(`status:${config.revision}`, 60_000, async () =>
		isIndexOnly(config)
			? readIndexedStatus(config)
			: readPublicLibraryStatus(await getDatabaseForConfig(config), config),
	);
}
