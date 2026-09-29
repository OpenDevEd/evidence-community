import "server-only";
import { cacheLife } from "next/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import { readTopicTree, resolveTopicAncestry } from "./catalog";
import type { TopicTree } from "./contract";

async function topicContext() {
	const config = await getLibraryConfig();
	return config.topics.enabled ? { database: await getDatabaseForConfig(config), config } : null;
}

/** A record with its topic names, so its page draws the topics row once, complete. */
export async function withTopicNames<T extends { item?: { key?: string; topics?: string[] } | null } | null>(
	data: T,
): Promise<T | (T & { topics: TopicTree })> {
	const ids = data?.item?.topics;
	const context = ids?.length ? await topicContext() : null;
	if (!data || !ids?.length || !context) return data;
	try {
		return { ...data, topics: await readTopicTree(ids, context) };
	} catch (error) {
		// The row then asks for the names itself and offers a retry if that fails too.
		console.error("Item topic names could not be read", { key: data.item?.key, error });
		return data;
	}
}

async function readSelectedTopicTree(selected: readonly string[], _configRevision: string, config: LibraryServerConfig) {
	"use cache";
	cacheLife({ revalidate: 300 });
	const context = { database: await getDatabaseForConfig(config), config };
	const ancestry = await resolveTopicAncestry(selected, context, { allowUnknown: true });
	return readTopicTree(ancestry.map((node) => node.id), context);
}

/** Names for the selected topics and their ancestors, so a first visit draws the chips with names in its HTML. */
export async function readSelectedTopicNames(selected: readonly string[]): Promise<TopicTree | null> {
	const config = selected.length ? await getLibraryConfig() : null;
	if (!config?.topics.enabled) return null;
	try {
		return await readSelectedTopicTree([...selected].sort(), config.revision, config);
	} catch (error) {
		// The chips then wait for the tree request instead.
		console.error("Selected topic names could not be read", { selected, error });
		return null;
	}
}
