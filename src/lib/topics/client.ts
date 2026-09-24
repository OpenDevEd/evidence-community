import {
	topicCatalogResponseSchema,
	topicDetailResponseSchema,
} from "./contract";

async function topicResponse(url: URL) {
	const response = await fetch(url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`Topic request failed with status ${response.status}`);
	}
	return response.json() as Promise<unknown>;
}

export async function fetchTopicCatalog(input: {
	ids?: readonly string[];
	parent?: string | null;
	query?: string;
}) {
	const url = new URL("/api/topics/catalog", window.location.origin);
	if (input.ids) url.searchParams.set("ids", input.ids.join(","));
	else if (input.query !== undefined)
		url.searchParams.set("query", input.query);
	else url.searchParams.set("parent", input.parent ?? "");
	return topicCatalogResponseSchema.parse(await topicResponse(url));
}

export async function fetchTopicDetail(topicId: string) {
	const url = new URL("/api/topics/detail", window.location.origin);
	url.searchParams.set("topicId", topicId);
	return topicDetailResponseSchema.parse(await topicResponse(url));
}

export async function fetchTopicNodeClosure(ids: readonly string[]) {
	const nodes = new Map<
		string,
		Awaited<ReturnType<typeof fetchTopicCatalog>>["nodes"][number]
	>();
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
