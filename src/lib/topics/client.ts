import {
	topicCatalogResponseSchema,
	topicDetailResponseSchema,
	topicNodeIdSchema,
	topicTreeSchema,
} from "./contract";
import useSWR from "swr";
import { use, useContext } from "react";
import { SelectedTopicNamesContext } from "@/components/topics/SelectedTopicNames";

const CATALOG_PAGE_SIZE = 100;

export type TopicCatalogInput = {
	ids?: readonly string[];
	parent?: string | null;
	query?: string;
	cursor?: string | null;
	limit?: number;
};

async function topicResponse(url: URL) {
	const response = await fetch(url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`Topic request failed with status ${response.status}`);
	}
	return response.json() as Promise<unknown>;
}

async function fetchTopicCatalogPage(input: TopicCatalogInput) {
	const url = new URL("/api/topics/catalog", window.location.origin);
	if (input.ids) url.searchParams.set("ids", input.ids.join(","));
	else if (input.query !== undefined)
		url.searchParams.set("query", input.query);
	else url.searchParams.set("parent", input.parent ?? "");
	if (input.cursor) url.searchParams.set("cursor", input.cursor);
	url.searchParams.set("limit", String(input.limit ?? CATALOG_PAGE_SIZE));
	return topicCatalogResponseSchema.parse(await topicResponse(url));
}

function combineTopicCatalogPages(
	pages: Awaited<ReturnType<typeof fetchTopicCatalogPage>>[],
) {
	const first = pages[0];
	if (!first) throw new Error("Topic catalog request contained no IDs");
	if (
		pages.some(
			(page) =>
				page.revision !== first.revision ||
				page.publicBaseUrl !== first.publicBaseUrl,
		)
	) {
		throw new Error("Topic catalog changed during paging");
	}
	return {
		...pages.at(-1)!,
		nodes: [
			...new Map(
				pages.flatMap((page) => page.nodes).map((node) => [node.id, node]),
			).values(),
		],
	};
}

export async function fetchTopicCatalog(input: TopicCatalogInput) {
	if (input.ids) input = {...input, ids: input.ids.filter(id => topicNodeIdSchema.safeParse(id).success)};
	if (!input.ids || input.ids.length <= CATALOG_PAGE_SIZE) {
		return fetchTopicCatalogPage(input);
	}
	const pages = await Promise.all(
		Array.from(
			{ length: Math.ceil(input.ids.length / CATALOG_PAGE_SIZE) },
			(_, index) =>
				fetchTopicCatalogPage({
					...input,
					ids: input.ids!.slice(
						index * CATALOG_PAGE_SIZE,
						(index + 1) * CATALOG_PAGE_SIZE,
					),
				}),
		),
	);
	return combineTopicCatalogPages(pages);
}

export async function fetchAllTopicCatalogPages(
	input: Pick<TopicCatalogInput, "parent">,
) {
	const pages: Awaited<ReturnType<typeof fetchTopicCatalogPage>>[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | null = null;
	do {
		const page = await fetchTopicCatalogPage({ ...input, cursor });
		pages.push(page);
		cursor = page.nextCursor;
		if (cursor) {
			if (seenCursors.has(cursor))
				throw new Error("Topic catalog did not advance");
			seenCursors.add(cursor);
		}
	} while (cursor);
	return { ...combineTopicCatalogPages(pages), nextCursor: null };
}

export async function fetchTopicDetail(topicId: string) {
	const url = new URL("/api/topics/detail", window.location.origin);
	url.searchParams.set("topicId", topicId);
	return topicDetailResponseSchema.parse(await topicResponse(url));
}

/**
 * The library's topic tree, fetched once and shared by the filter, its chips and item pages. `seeded` callers show the
 * server's names for the URL's topics until it arrives, suspending for them on a first visit.
 */
export function useTopicTree({ enabled = true, seeded = false } = {}) {
	const selectedNames = useContext(SelectedTopicNamesContext);
	const tree = useSWR(
		enabled ? "topic-tree" : null,
		async () => {
			const url = new URL("/api/topics/tree", window.location.origin);
			return topicTreeSchema.parse(await topicResponse(url));
		},
		// Each mount asks again; the browser answers from its cache for five minutes.
		{ revalidateOnFocus: false },
	);
	return {
		data:
			tree.data ??
			(enabled && seeded && selectedNames
				? (use(selectedNames) ?? undefined)
				: undefined),
		error: tree.error,
		mutate: tree.mutate,
	};
}
