import { afterEach, describe, expect, it, vi } from "vitest";

import { elasticsearchEmbeddings, missingPage } from "@/lib/search-index/elasticsearch-embeddings";
import type { ItemSearchDocument } from "@/lib/search-index/projection";

function record(key: string, title: string) {
	return { key, title, tags: [], collections: [], collectionsAncestry: [], topics: [], topicAncestors: [] } as unknown as ItemSearchDocument;
}

/**
 * An index holding `stored` records' vectors and hashes, and `missing` records without one. Its bulk updates answer
 * 409 for the keys in `writtenMeanwhile`, as for records written since they were read.
 */
function library(
	stored: Record<string, { embedding: number[]; embeddingHash: string }> = {},
	missing: Array<{ key: string; title: string }> = [],
	writtenMeanwhile: string[] = [],
) {
	const client = {
		search: vi.fn(async (body: { query: { ids?: { values: string[] } } }) => {
			if (body.query.ids) {
				const hits = body.query.ids.values.filter((key) => stored[key]).map((key) => ({ _id: key, _source: stored[key] }));
				return { hits: { hits } };
			}
			const hits = missing.map(({ key, title }, position) => ({ _id: key, _index: "library_1", _seq_no: position, _primary_term: 1, sort: [key], _source: { title } }));
			return { hits: { hits } };
		}),
		bulk: vi.fn(async ({ operations }: { operations: Array<{ update?: { _id: string } }> }) => ({
			errors: false,
			items: operations.flatMap((operation) => {
				if (!operation.update) return [];
				const { _id } = operation.update;
				return [{ update: writtenMeanwhile.includes(_id) ? { _id, status: 409, error: { type: "version_conflict_engine_exception" } } : { _id, status: 200 } }];
			}),
		})),
	};
	return { client, service: { alias: "library", client } as never };
}

function embedder(fail = false, refuse = "", fingerprint = "perplexity-0.6b") {
	return {
		fingerprint,
		capacity: 80,
		embed: vi.fn(async (texts: readonly string[]) => {
			if (fail) throw new Error("401 bad key");
			return texts.map((text) => (refuse && text.includes(refuse) ? null : [text.length, 1]));
		}),
	};
}

afterEach(() => {
	vi.useRealTimers();
});

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

	it("embeds a record again when another text or another embedder made its stored vector", async () => {
		const [written] = await elasticsearchEmbeddings(library().service, embedder()).attach([record("A", "Radio lessons")]);
		const { service } = library({ A: { embedding: [9, 9], embeddingHash: written!.embeddingHash as string } });
		const [changedText] = await elasticsearchEmbeddings(service, embedder()).attach([record("A", "Radio lessons, revised")]);
		const [changedEmbedder] = await elasticsearchEmbeddings(service, embedder(false, "", "another-model")).attach([record("A", "Radio lessons")]);
		expect(changedText!.embedding).not.toEqual([9, 9]);
		expect(changedEmbedder).toMatchObject({ embeddingModel: "another-model" });
		expect(changedEmbedder!.embedding).not.toEqual([9, 9]);
	});

	it("only reuses stored vectors in a rebuild, leaving the rest to the backfill", async () => {
		const model = embedder();
		const [document] = await elasticsearchEmbeddings(library().service, model).attach([record("A", "Radio lessons")], undefined, { embedNew: false });
		expect(model.embed).not.toHaveBeenCalled();
		expect(document).not.toHaveProperty("embedding");
		expect(document).not.toHaveProperty("embeddingModel");
	});

	it("writes records without vectors while the embedder fails, and asks it again after a minute, then two", async () => {
		vi.useFakeTimers();
		const failing = embedder(true);
		const embeddings = elasticsearchEmbeddings(library().service, failing);
		const [document] = await embeddings.attach([record("A", "Radio lessons")]);
		expect(document).not.toHaveProperty("embedding");
		expect(embeddings.lastError()).toContain("401 bad key");
		await embeddings.attach([record("B", "Mobile phones")]);
		expect(failing.embed).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(61_000);
		await embeddings.attach([record("B", "Mobile phones")]);
		expect(failing.embed).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(61_000);
		await embeddings.attach([record("B", "Mobile phones")]);
		expect(failing.embed).toHaveBeenCalledTimes(2);
	});

	it("marks a text the embedder refuses, and doesn't ask again while the text stays the same", async () => {
		const [marked] = await elasticsearchEmbeddings(library().service, embedder(false, "Radio")).attach([record("A", "Radio lessons")]);
		expect(marked).not.toHaveProperty("embedding");
		expect(marked).toMatchObject({ embeddingHash: expect.any(String), embeddingModel: "perplexity-0.6b" });
		const { service } = library({ A: { embeddingHash: marked!.embeddingHash as string } as never });
		const model = embedder();
		const [again] = await elasticsearchEmbeddings(service, model).attach([record("A", "Radio lessons")]);
		expect(model.embed).not.toHaveBeenCalled();
		expect(again).not.toHaveProperty("embedding");
	});

	it("gives records written without a vector one, only where nothing wrote them since", async () => {
		const { client, service } = library({}, [
			{ key: "A", title: "Radio lessons" },
			{ key: "B", title: "Mobile phones" },
		], ["B"]);
		expect(await elasticsearchEmbeddings(service, embedder()).embedMissing()).toBe(1);
		const [{ operations }] = client.bulk.mock.calls[0] as unknown as [{ operations: Array<Record<string, unknown>> }];
		expect(operations[0]).toEqual({ update: { _index: "library_1", _id: "A", if_seq_no: 0, if_primary_term: 1 } });
		expect(operations[1]).toMatchObject({ doc: { embedding: [expect.any(Number), 1], embeddingHash: expect.any(String), embeddingModel: "perplexity-0.6b" } });
	});

	it("reads pages that keep 128 requests in flight twice over, and writes their vectors 500 records a request", async () => {
		const missing = Array.from({ length: 600 }, (_, index) => ({ key: `R${String(index).padStart(3, "0")}`, title: `Record ${index}` }));
		const { client, service } = library({}, missing);
		const model = { ...embedder(), capacity: 1_280 };
		expect(missingPage(model)).toBe(2_560);
		expect(await elasticsearchEmbeddings(service, model).embedMissing()).toBe(600);
		const writes = client.bulk.mock.calls.map(([{ operations }]) => operations.length);
		expect(writes).toEqual([1_000, 200]);
	});
});
