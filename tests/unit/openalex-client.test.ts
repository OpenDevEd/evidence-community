import { describe, expect, it } from "vitest";
import { OpenAlexClient } from "@/lib/source-ingestion/openalex/client";

const query = { filter: "authorships.countries:ke", search: "AI in education" };
const page = {
	meta: { count: 1, next_cursor: null },
	results: [{ id: "https://openalex.org/W123" }],
};

describe("OpenAlex works requests", () => {
	it("sends only the approved query and resumes at the saved cursor", async () => {
		let requested: URL | undefined;
		const client = new OpenAlexClient({
			apiKey: "test-key",
			fetch: async (input, init) => {
				requested = new URL(String(input));
				expect(init?.redirect).toBe("error");
				return Response.json(page);
			},
		});
		expect(await client.works(query, "next+/=")).toEqual(page);
		expect(requested?.origin).toBe("https://api.openalex.org");
		expect(Object.fromEntries(requested!.searchParams)).toEqual({
			filter: query.filter,
			search: query.search,
			cursor: "next+/=",
			per_page: "100",
			api_key: "test-key",
		});
	});

	it("posts an OQL query to the API root with the cursor and page size in the URL", async () => {
		const oql = "works where (title has (chatgpt)) and is_retracted is (false)";
		let requested: { url: URL; init?: RequestInit } | undefined;
		const client = new OpenAlexClient({
			apiKey: "test-key",
			fetch: async (input, init) => {
				requested = { url: new URL(String(input)), init };
				return Response.json(page);
			},
		});
		expect(await client.works({ oql }, "*")).toEqual(page);
		expect(requested?.url.pathname).toBe("/");
		expect(Object.fromEntries(requested!.url.searchParams)).toEqual({
			cursor: "*",
			per_page: "100",
			api_key: "test-key",
		});
		expect(requested?.init?.method).toBe("POST");
		expect(JSON.parse(String(requested?.init?.body))).toEqual({ oql });
	});

	it("rejects an OQL query mixed with a search, or one that narrows nothing", async () => {
		const client = new OpenAlexClient({ apiKey: "test-key", fetch: async () => Response.json(page) });
		await expect(client.works({ oql: "works where title has (x)", search: "x" }, "*")).rejects.toThrow(/either OQL/);
		await expect(client.works({ oql: "works where is_retracted is (false)" }, "*")).rejects.toThrow(/requires a search or filter/);
		await expect(client.works({ oql: "works" }, "*")).rejects.toThrow(/requires a search or filter/);
		await expect(client.works({ oql: "works where (IS_RETRACTED is (false)) and retracted is (false)" }, "*")).rejects.toThrow(/requires a search or filter/);
		await expect(client.works({ oql: "works where (is_retracted is (false)) or (is_retracted is (false))" }, "*")).rejects.toThrow(/requires a search or filter/);
	});

	it("retries throttling with Retry-After without dropping the cursor", async () => {
		const cursors: string[] = [];
		const delays: number[] = [];
		const client = new OpenAlexClient({
			apiKey: "test-key",
			sleep: async (ms) => {
				delays.push(ms);
			},
			fetch: async (input) => {
				cursors.push(
					new URL(String(input)).searchParams.get("cursor")!,
				);
				return cursors.length === 1
					? new Response(null, {
							status: 429,
							headers: { "Retry-After": "2" },
						})
					: Response.json(page);
			},
		});
		expect(await client.works(query, "saved")).toEqual(page);
		expect(cursors).toEqual(["saved", "saved"]);
		expect(delays).toEqual([2000]);
	});

	it("bounds smaller PDF-processing pages even when the provider sends too many works", async () => {
		let requestedSize: string | null = null;
		const client = new OpenAlexClient({
			apiKey: "test-key",
			fetch: async (input) => {
				requestedSize = new URL(String(input)).searchParams.get(
					"per_page",
				);
				return Response.json({
					...page,
					results: Array.from({ length: 11 }, (_, index) => ({
						id: `https://openalex.org/W${index}`,
					})),
				});
			},
		});
		await expect(client.works(query, "*", 10)).rejects.toThrow(
			/more works/,
		);
		expect(requestedSize).toBe("10");
	});

	it("rejects invalid pagination instead of treating it as a completed import", async () => {
		const client = new OpenAlexClient({
			apiKey: "test-key",
			fetch: async () => Response.json({ results: [] }),
		});
		await expect(client.works(query, "*")).rejects.toThrow();
	});

	it("bounds streamed responses without relying on Content-Length", async () => {
		let canceled = false;
		const client = new OpenAlexClient({
			apiKey: "test-key",
			maxResponseBytes: 64,
			fetch: async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(new Uint8Array(65));
						},
						cancel() {
							canceled = true;
						},
					}),
				),
		});
		await expect(client.works(query, "*")).rejects.toThrow(/limit|large/i);
		expect(canceled).toBe(true);
	});

	it("asks for smaller pages at the same cursor while OpenAlex's search times out, then grows again", async () => {
		const searchTimeout = () =>
			Response.json(
				{ validation: { valid: false, errors: [{ type: "es_error", message: "Elasticsearch error: Connection timed out" }] } },
				{ status: 500 },
			);
		const requests: { cursor: string; size: number }[] = [];
		const client = new OpenAlexClient({
			apiKey: "test-key",
			sleep: async () => {},
			fetch: async (input) => {
				const url = new URL(String(input));
				const size = Number(url.searchParams.get("per_page"));
				requests.push({ cursor: url.searchParams.get("cursor")!, size });
				return size > 50 ? searchTimeout() : Response.json(page);
			},
		});

		expect(await client.works(query, "saved", 200, { followsCursor: true })).toEqual(page);
		expect(requests).toEqual([
			{ cursor: "saved", size: 200 },
			{ cursor: "saved", size: 100 },
			{ cursor: "saved", size: 50 },
		]);

		// Later pages start at the size that worked. Ten pages at that size in all, and the next tries twice as many.
		requests.length = 0;
		for (let index = 0; index < 11; index++) await client.works(query, "next", 200, { followsCursor: true });
		expect(requests.map(({ size }) => size)).toEqual([...Array(9).fill(50), 100, 50, 50]);

		// A caller that reads one page and ignores the cursor always gets the size it asked for.
		requests.length = 0;
		await expect(client.works(query, "*", 100)).rejects.toMatchObject({ status: 500 });
		expect(new Set(requests.map(({ size }) => size))).toEqual(new Set([100]));
	});

	it("waits out an OpenAlex outage of up to an hour, then reports the last answer", async () => {
		const waits: number[] = [];
		let failures = 0;
		const client = new OpenAlexClient({
			apiKey: "test-key",
			sleep: async (ms) => {
				waits.push(ms);
			},
			fetch: async () => {
				if (failures-- > 0) {
					if (failures % 2) throw new TypeError("fetch failed");
					return new Response("Service unavailable", { status: 503 });
				}
				return Response.json(page);
			},
		});

		// Forty failures in a row, mixing lost connections and 503s: about half an hour of waiting.
		failures = 40;
		expect(await client.works(query, "saved")).toEqual(page);
		expect(waits).toHaveLength(40);
		expect(Math.max(...waits)).toBe(60_000);

		// One that never ends stops once the next wait would pass an hour.
		waits.length = 0;
		failures = Number.POSITIVE_INFINITY;
		await expect(client.works(query, "saved")).rejects.toThrow(/request failed|503/);
		const waited = waits.reduce((sum, ms) => sum + ms, 0);
		expect(waited).toBeLessThanOrEqual(60 * 60_000);
		expect(waited).toBeGreaterThan(59 * 60_000);
	});

	it("still asks for a smaller page when the search times out on the last retry", async () => {
		const sizes: number[] = [];
		const client = new OpenAlexClient({
			apiKey: "test-key",
			sleep: async () => {},
			fetch: async (input) => {
				sizes.push(Number(new URL(String(input)).searchParams.get("per_page")));
				if (sizes.length < 6) return new Response("Bad gateway", { status: 502 });
				return sizes.length === 6
					? Response.json({ errors: [{ message: "Elasticsearch error: Connection timed out" }] }, { status: 500 })
					: Response.json(page);
			},
		});
		expect(await client.works(query, "saved", 200, { followsCursor: true })).toEqual(page);
		expect(sizes).toEqual([...Array(6).fill(200), 100]);
	});

	it("asks for a short page with no cursor again before a followed scan ends on it", async () => {
		const works = (length: number) => Array.from({ length }, (_, index) => ({ id: `https://openalex.org/W${index}` }));
		const cutShort = { meta: { count: 94_216, next_cursor: null }, results: works(95) };
		const full = { meta: { count: 94_216, next_cursor: "after" }, results: works(100) };
		const answers = [cutShort, full];
		const cursors: string[] = [];
		const client = new OpenAlexClient({
			apiKey: "test-key",
			sleep: async () => {},
			fetch: async (input) => {
				cursors.push(new URL(String(input)).searchParams.get("cursor")!);
				return Response.json(answers.shift() ?? cutShort);
			},
		});
		expect(await client.works(query, "saved", 100, { followsCursor: true })).toEqual(full);
		expect(cursors).toEqual(["saved", "saved"]);

		// A short page that comes back the same every time is the real end.
		cursors.length = 0;
		expect(await client.works(query, "saved", 100, { followsCursor: true })).toEqual(cutShort);
		expect(cursors).toEqual(["saved", "saved", "saved"]);

		// A search timeout while asking again asks for a smaller page, as any other page would.
		cursors.length = 0;
		const sizes: number[] = [];
		const half = { meta: { count: 94_216, next_cursor: "after" }, results: works(50) };
		const timesOut = new OpenAlexClient({
			apiKey: "test-key",
			sleep: async () => {},
			fetch: async (input) => {
				const size = Number(new URL(String(input)).searchParams.get("per_page"));
				sizes.push(size);
				if (sizes.length === 1) return Response.json(cutShort);
				return size > 50
					? Response.json({ errors: [{ message: "Elasticsearch error: Connection timed out" }] }, { status: 500 })
					: Response.json(half);
			},
		});
		expect(await timesOut.works(query, "saved", 100, { followsCursor: true })).toEqual(half);
		expect(sizes).toEqual([100, 100, 50]);

		// A caller that ignores the cursor, or a page holding every work, is not asked for again.
		cursors.length = 0;
		answers.push(cutShort, page);
		expect(await client.works(query, "saved", 100)).toEqual(cutShort);
		expect(await client.works(query, "*", 100, { followsCursor: true })).toEqual(page);
		expect(cursors).toEqual(["saved", "*"]);
	});

	it("retries other server errors at the same page size", async () => {
		const sizes: number[] = [];
		const client = new OpenAlexClient({
			apiKey: "test-key",
			sleep: async () => {},
			fetch: async (input) => {
				sizes.push(Number(new URL(String(input)).searchParams.get("per_page")));
				if (sizes.length === 1) return new Response("Bad gateway", { status: 502 });
				// A 500 whose body cannot be read is retried like any other.
				if (sizes.length === 2) return new Response(null, { status: 500 });
				return Response.json(page);
			},
		});
		expect(await client.works(query, "saved", 200, { followsCursor: true })).toEqual(page);
		expect(sizes).toEqual([200, 200, 200]);
	});

	it("reports provider failures without retrying authentication errors", async () => {
		let calls = 0;
		const client = new OpenAlexClient({
			apiKey: "test-key",
			fetch: async () => {
				calls++;
				return new Response("Invalid key", { status: 401 });
			},
		});
		await expect(client.works(query, "*")).rejects.toMatchObject({
			status: 401,
			message: expect.stringContaining("Invalid key"),
		});
		expect(calls).toBe(1);
	});
});
