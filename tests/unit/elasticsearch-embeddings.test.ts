import { describe, expect, it, vi } from "vitest";

import { elasticsearchEmbeddings } from "@/lib/search-index/elasticsearch-embeddings";
import type { ItemSearchDocument } from "@/lib/search-index/projection";

function record(key: string, title: string) {
	return { key, title, tags: [], collections: [], collectionsAncestry: [], topics: [], topicAncestors: [] } as unknown as ItemSearchDocument;
}

/** An index holding `stored` records' vectors and hashes, and `missing` records without one. */
function library(stored: Record<string, { embedding: number[]; embeddingHash: string }> = {}, missing: Array<{ key: string; title: string }> = []) {
	const client = {
		search: vi.fn(async (body: { query: { ids?: { values: string[] } } }) => {
			if (body.query.ids) {
				const hits = body.query.ids.values.filter((key) => stored[key]).map((key) => ({ _id: key, _source: stored[key] }));
				return { hits: { hits } };
			}
			const hits = missing.map(({ key, title }, position) => ({ _id: key, _index: "library_1", _seq_no: position, _primary_term: 1, sort: [key], _source: { title } }));
			return { hits: { hits } };
		}),
		bulk: vi.fn(async () => ({ errors: false, items: [] })),
	};
	return { client, service: { alias: "library", client } as never };
}

function embedder(fail = false) {
	return {
		fingerprint: "perplexity-0.6b",
		embed: vi.fn(async (texts: readonly string[]) => {
			if (fail) throw new Error("401 bad key");
			return texts.map((text) => [text.length, 1]);
		}),
	};
}

describe("records' vectors in Elasticsearch", () => {
	it("reuses the vector the same embedder made from the same text, and embeds the rest", async () => {
		const first = elasticsearchEmbeddings(library().service, embedder());
		const [written] = await first.attach([record("A", "Radio lessons")]);
		const { service } = library({ A: { embedding: [9, 9], embeddingHash: written!.embeddingHash as string } });
		const model = embedder();
		const documents = await elasticsearchEmbeddings(service, model).attach([record("A", "Radio lessons"), record("B", "Mobile phones")]);
		expect(documents.map((document) => document.embedding)).toEqual([[9, 9], [expect.any(Number), 1]]);
		expect(model.embed).toHaveBeenCalledWith(["A research record titled 'Mobile phones'.   Keywords: . "], undefined);
	});

	it("embeds a record again once its text changed", async () => {
		const { service } = library({ A: { embedding: [9, 9], embeddingHash: "made-from-an-older-title" } });
		const [document] = await elasticsearchEmbeddings(service, embedder()).attach([record("A", "Radio lessons")]);
		expect(document!.embedding).not.toEqual([9, 9]);
	});

	it("writes records without vectors while the embedder fails, and leaves it alone for a minute", async () => {
		const failing = embedder(true);
		const embeddings = elasticsearchEmbeddings(library().service, failing);
		const [document] = await embeddings.attach([record("A", "Radio lessons")]);
		expect(document).not.toHaveProperty("embedding");
		expect(embeddings.lastError()).toContain("401 bad key");
		await embeddings.attach([record("B", "Mobile phones")]);
		expect(failing.embed).toHaveBeenCalledTimes(1);
	});

	it("gives records written without a vector one, only where nothing wrote them since", async () => {
		const { client, service } = library({}, [
			{ key: "A", title: "Radio lessons" },
			{ key: "B", title: "Mobile phones" },
		]);
		expect(await elasticsearchEmbeddings(service, embedder()).embedMissing()).toBe(2);
		const [{ operations }] = client.bulk.mock.calls[0] as unknown as [{ operations: Array<Record<string, unknown>> }];
		expect(operations[0]).toEqual({ update: { _index: "library_1", _id: "A", if_seq_no: 0, if_primary_term: 1 } });
		expect(operations[1]).toMatchObject({ doc: { embedding: [expect.any(Number), 1], embeddingHash: expect.any(String), embeddingModel: "perplexity-0.6b" } });
	});
});
