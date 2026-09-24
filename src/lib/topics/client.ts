import {
	topicCatalogResponseSchema,
	topicDetailResponseSchema,
	type TopicNode,
} from "./contract";

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

export async function fetchTopicNodeClosure(ids: readonly string[]) {
	const nodes = new Map<string, TopicNode>();
	let pending = [...new Set(ids)];
	for (let depth = 0; pending.length && depth < 4; depth += 1) {
		const response = await fetchTopicCatalog({ ids: pending });
		for (const node of response.nodes) nodes.set(node.id, node);
		pending = [
			...new Set(
				response.nodes.flatMap((node) =>
					node.parent && !nodes.has(node.parent) ? [node.parent] : [],
				),
			),
		];
	}
	if (pending.length) throw new Error("Topic hierarchy exceeds four levels");
	return [...nodes.values()];
}
