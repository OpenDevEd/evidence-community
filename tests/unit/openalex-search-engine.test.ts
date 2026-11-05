import { describe, expect, it } from "vitest";

import { OpenAlexClient } from "@/lib/source-ingestion/openalex/client";
import { asOpenAlexWork, readSearchEngineAccess } from "@/lib/source-ingestion/openalex/search-engine";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";

const key = "openscholar-search:osk_key:client.access:secret";
const engineWork = {
	id: "https://openscholar.ai/OS130479725",
	ids: { openalex: "https://openalex.org/W2315890726", doi: "https://doi.org/10.1/abc" },
	title: "Teachers in Kenya",
	display_name: "Teachers in Kenya",
	type: "article",
	publication_year: 2023,
	referenced_works: ["https://openscholar.ai/OS1", "https://openscholar.ai/OS2"],
	referenced_works_count: 2,
};

function pages(body: unknown) {
	const requests: { url: URL; init?: RequestInit }[] = [];
	const fetcher = (async (url: URL, init?: RequestInit) => {
		requests.push({ url, init });
		return Response.json(body);
	}) as typeof fetch;
	return { requests, fetcher };
}

describe("reading Openscholar's search engine", () => {
	it("reads the engine's access from a source key, and nothing from an OpenAlex key", () => {
		expect(readSearchEngineAccess(key)).toEqual({ key: "osk_key", clientId: "client.access", clientSecret: "secret" });
		expect(readSearchEngineAccess("openalex-key")).toBeNull();
		expect(() => readSearchEngineAccess("openscholar-search:only-a-key")).toThrow("is written");
	});

	it("asks the engine with the key and Access token in headers, not in the address", async () => {
		const { requests, fetcher } = pages({ meta: { count: 1, next_cursor: null }, results: [engineWork] });

		await new OpenAlexClient({ apiKey: key, fetch: fetcher }).works({ oql: "works where year is (2023)" }, "*", 200);

		const [{ url, init }] = requests;
		expect(url.origin).toBe("https://search-api.openscholar.ai");
		expect(url.searchParams.has("api_key")).toBe(false);
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer osk_key",
			"CF-Access-Client-Id": "client.access",
			"CF-Access-Client-Secret": "secret",
		});
		expect(init?.body).toBe(JSON.stringify({ oql: "works where year is (2023)" }));
	});

	it("keeps asking OpenAlex with an OpenAlex key", async () => {
		const { requests, fetcher } = pages({ meta: { count: 0, next_cursor: null }, results: [] });

		await new OpenAlexClient({ apiKey: "openalex-key", fetch: fetcher }).works({ filter: "publication_year:2023" }, "*", 200);

		expect(requests[0].url.origin).toBe("https://api.openalex.org");
		expect(requests[0].url.searchParams.get("api_key")).toBe("openalex-key");
	});

	it("gives a work OpenAlex's id, so the mapper takes it, and leaves references it can't name", async () => {
		const { fetcher } = pages({ meta: { count: 1, next_cursor: null }, results: [engineWork] });

		const page = await new OpenAlexClient({ apiKey: key, fetch: fetcher }).works({ oql: "works where year is (2023)" }, "*", 200);
		const { items } = mapOpenAlexWork(page.results[0]);

		expect(items[0].sourceRecordKey).toBe("W2315890726");
		expect(items[0].referencedSourceRecordKeys).toEqual([]);
		expect(items[0].metadata).toMatchObject({ title: "Teachers in Kenya" });
	});

	it("leaves out a work OpenAlex doesn't hold, instead of stopping the import", async () => {
		const stray = { ...engineWork, ids: { doi: "https://doi.org/10.1/abc" } };
		expect(asOpenAlexWork(stray)).toBeNull();
		const { fetcher } = pages({ meta: { count: 2, next_cursor: "next" }, results: [stray, engineWork] });

		const page = await new OpenAlexClient({ apiKey: key, fetch: fetcher }).works({ oql: "works where year is (2023)" }, "*", 200);

		expect(page.results).toHaveLength(1);
		expect(page.meta.next_cursor).toBe("next");
	});

	it("never sends the engine's key to OpenAlex for an institution", async () => {
		const { requests, fetcher } = pages({ results: [] });

		await new OpenAlexClient({ apiKey: key, fetch: fetcher }).institutionLocations(["I1"]);

		expect(requests).toEqual([]);
	});
});
