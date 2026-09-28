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
