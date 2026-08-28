import { isToolUIPart } from "ai";

import type { ResearchUIMessage } from "@/lib/ai/agent";
import type { BucketEntry } from "@/context/InlineChatLayout";

// Publication links the assistant writes in its answers: `/lib/KEY`, with or
// without a language prefix, followed by a download path, query, or bracket.
const CITED_KEY_PATTERN = /\/lib\/([A-Za-z0-9]+)(?=[/?#)\s"'\]]|$)/g;

type BucketSources = Map<string, BucketEntry["source"]>;
type ToolPart = Extract<
	ResearchUIMessage["parts"][number],
	{ toolCallId: string }
>;

/** Anything the assistant links to in its own words counts as a source. */
function addCitedKeys(entries: BucketSources, text: string) {
	for (const match of text.matchAll(CITED_KEY_PATTERN)) {
		if (!entries.has(match[1])) entries.set(match[1], "search");
	}
}

/** A publication it opened outranks one it merely found. */
function addReadKeys(entries: BucketSources, part: ToolPart) {
	const input = part.input as { itemKeys?: string[] } | undefined;
	for (const key of input?.itemKeys ?? []) {
		entries.delete(key);
		entries.set(key, "read");
	}
}

function addSearchHits(entries: BucketSources, part: ToolPart) {
	const output = part.output as
		| { queries?: Array<{ hits?: Array<{ key?: string }> }> }
		| undefined;
	for (const query of output?.queries ?? []) {
		for (const hit of query.hits ?? []) {
			if (hit.key && !entries.has(hit.key)) {
				entries.set(hit.key, "search");
			}
		}
	}
}

function collectBucketSources(
	entries: BucketSources,
	message: ResearchUIMessage,
) {
	for (const part of message.parts) {
		if (message.role === "assistant" && part.type === "text") {
			addCitedKeys(entries, part.text);
			continue;
		}
		if (!isToolUIPart(part)) continue;
		if (part.type === "tool-readPublications") addReadKeys(entries, part);
		if (part.type === "tool-searchLibrary") addSearchHits(entries, part);
	}
}

/**
 * The publications this conversation has touched, most recently touched
 * first. Search hits join where they were first seen; opening a publication
 * moves it to the front, so the paper being worked on always leads.
 */
export function bucketEntriesFromMessages(
	messages: ResearchUIMessage[],
): BucketEntry[] {
	const entries: BucketSources = new Map();
	for (const message of messages) collectBucketSources(entries, message);

	return Array.from(entries, ([key, source]) => ({ key, source })).reverse();
}

/** How many publications one request asks the library for. */
export const BUCKET_PAGE_SIZE = 200;

/**
 * Loads every publication the conversation asks for, a page at a time.
 *
 * A conversation can touch more publications than one request returns, so the
 * pages are asked for in turn until they are all in. If a request fails, the
 * whole load fails and says why, instead of quietly missing publications.
 */
export async function loadBucketPages<Item>(
	keyCount: number,
	loadPage: (page: number) => Promise<{ items: Item[]; totalPages: number }>,
): Promise<Item[]> {
	// The library can never have more pages of these than we asked keys for.
	const mostPages = Math.max(1, Math.ceil(keyCount / BUCKET_PAGE_SIZE));
	const items: Item[] = [];
	let page = 1;
	let lastPage = 1;

	do {
		const answer = await loadPage(page);
		items.push(...answer.items);
		lastPage = Math.min(answer.totalPages, mostPages);
		page += 1;
	} while (page <= lastPage);

	return items;
}
