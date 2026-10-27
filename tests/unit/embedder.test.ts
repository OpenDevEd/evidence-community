import { afterEach, describe, expect, it, vi } from "vitest";

import { answerVectors, createEmbedder, embedderFingerprint, EmbedderError, requestBody } from "@/lib/embedder";

/** AIED's embedder: Perplexity's 0.6B model through OpenRouter, several texts a request. */
const openRouter = {
	source: "rest" as const,
	url: "https://openrouter.ai/api/v1/embeddings",
	apiKey: "router-key",
	dimensions: 3,
	request: { model: "perplexity/pplx-embed-v1-0.6b", input: ["{{text}}", "{{..}}"] },
	response: { data: [{ embedding: "{{embedding}}" }, "{{..}}"] },
};

/** A service answering one vector a text, `[length, 1, 0]`, for any text it is sent. */
function answering(status = 200) {
	return vi.fn(async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as { input: string[] };
		const data = body.input.map((text) => ({ embedding: [text.length, 1, 0] }));
		return new Response(JSON.stringify({ data }), { status });
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the library's embedder templates", () => {
	it("repeats the batch entry for each text and reads each vector in order", () => {
		expect(requestBody(openRouter.request, ["a", "b"])).toEqual({ model: "perplexity/pplx-embed-v1-0.6b", input: ["a", "b"] });
		expect(answerVectors(openRouter.response, { data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5, 6] }] })).toEqual([
			[1, 2, 3],
			[4, 5, 6],
		]);
	});

	it("puts one text where the template sends one, and reads one vector", () => {
		expect(requestBody({ inputs: "{{text}}", truncate: true }, ["a"])).toEqual({ inputs: "a", truncate: true });
		expect(answerVectors({ result: { vector: "{{embedding}}" } }, { result: { vector: [1, 2] } })).toEqual([[1, 2]]);
	});
});

describe("calling the library's embedder", () => {
	it("sends the texts 10 a request, as Meilisearch does, with the key, and answers a vector for each in order", async () => {
		const fetch = answering();
		vi.stubGlobal("fetch", fetch);
		const texts = Array.from({ length: 25 }, (_, index) => "x".repeat(index + 1));
		const vectors = await createEmbedder(openRouter)!.embed(texts);
		expect(fetch.mock.calls.map(([, init]) => (JSON.parse(String(init.body)) as { input: string[] }).input.length)).toEqual([10, 10, 5]);
		expect(fetch.mock.calls[0]![1].headers).toMatchObject({ Authorization: "Bearer router-key" });
		expect(vectors.map((vector) => vector?.[0])).toEqual(texts.map((text) => text.length));
	});

	it("finds the text the embedder refuses in a batch, and answers no vector for it alone", async () => {
		const ok = answering();
		const fetch = vi.fn(async (url: string, init: RequestInit) =>
			String(init.body).includes("too long") ? new Response("input too long", { status: 422 }) : ok(url, init),
		);
		vi.stubGlobal("fetch", fetch);
		const vectors = await createEmbedder(openRouter)!.embed(["a", "bb", "too long", "dddd"]);
		expect(vectors).toEqual([[1, 1, 0], [2, 1, 0], null, [4, 1, 0]]);
	});

	it("keeps the key out of what it reports", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("unknown key router-key", { status: 401 })));
		await expect(createEmbedder(openRouter)!.embed(["a"])).rejects.toThrow("unknown key [key]");
		vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError('Headers.append: "Bearer router-key" is an invalid header value.'))));
		const failure = await createEmbedder(openRouter)!.embed(["a"]).catch((error: Error) => error.message);
		expect(failure).not.toContain("router-key");
	});

	it("asks OpenAI for a size only for the models that take one", async () => {
		const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] })));
		vi.stubGlobal("fetch", fetch);
		await createEmbedder({ source: "openAi", model: "text-embedding-ada-002", apiKey: "k", dimensions: 3 })!.embed(["a"]);
		await createEmbedder({ source: "openAi", model: "text-embedding-3-small", apiKey: "k", dimensions: 3 })!.embed(["a"]);
		const bodies = fetch.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as { dimensions?: number });
		expect(bodies.map((body) => body.dimensions)).toEqual([undefined, 3]);
	});

	it("sends one request a text when the template holds one text", async () => {
		const fetch = vi.fn(async () => new Response(JSON.stringify({ embedding: [1, 0, 0] })));
		vi.stubGlobal("fetch", fetch);
		const embedder = createEmbedder({ ...openRouter, request: { input: "{{text}}" }, response: { embedding: "{{embedding}}" } })!;
		expect(await embedder.embed(["a", "b", "c"])).toHaveLength(3);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("tries again after the service answers busy", async () => {
		const ok = answering();
		const fetch = vi.fn(async (url: string, init: RequestInit) => (fetch.mock.calls.length === 1 ? new Response("slow down", { status: 429 }) : ok(url, init)));
		vi.stubGlobal("fetch", fetch);
		expect(await createEmbedder(openRouter)!.embed(["a"])).toEqual([[1, 1, 0]]);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("fails at once on a refusal, and on vectors of another size than configured", async () => {
		const refusing = vi.fn(async () => new Response("bad key", { status: 401 }));
		vi.stubGlobal("fetch", refusing);
		await expect(createEmbedder(openRouter)!.embed(["a"])).rejects.toThrow(EmbedderError);
		expect(refusing).toHaveBeenCalledTimes(1);
		vi.stubGlobal("fetch", answering());
		await expect(createEmbedder({ ...openRouter, dimensions: 1_024 })!.embed(["a"])).rejects.toThrow("isn't 1024 numbers");
	});

	it("has no embedder without a configuration, and a fingerprint that ignores the key", () => {
		expect(createEmbedder(null)).toBeNull();
		expect(embedderFingerprint({ ...openRouter, apiKey: "other-key" })).toBe(embedderFingerprint(openRouter));
		expect(embedderFingerprint({ ...openRouter, dimensions: 512 })).not.toBe(embedderFingerprint(openRouter));
	});
});
