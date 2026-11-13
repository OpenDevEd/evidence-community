import { describe, expect, it, vi } from "vitest";
import { createIndexNowNotifier, indexNowKey } from "@/lib/indexnow";

const config = (indexNow: boolean, secret = "a-secret-of-at-least-thirty-two-characters") => ({
	authentication: { secret },
	generation: { indexNow, redirects: true, sitemap: true },
	identity: { baseUrl: "https://community.example.org" },
}) as Parameters<typeof createIndexNowNotifier>[0];

const accepted = () => new Response(null, { status: 200 });
type Fetcher = (address: string, request: { body: string }) => Promise<Response>;
/** A stand-in for fetch that answers with `answer` and keeps what it was sent. */
const fetching = (answer: Fetcher = async () => accepted()) => vi.fn<Fetcher>(answer);
const asFetch = (fetcher: ReturnType<typeof fetching>) => fetcher as unknown as typeof fetch;
const sent = (fetcher: ReturnType<typeof fetching>, call = 0) => JSON.parse(fetcher.mock.calls[call][1].body) as { host: string; key: string; keyLocation: string; urlList: string[] };

describe("the IndexNow key", () => {
	it("is 32 hex characters, the same each time, and its own for each community", () => {
		const key = indexNowKey(config(true));
		expect(key).toMatch(/^[0-9a-f]{32}$/);
		expect(indexNowKey(config(true))).toBe(key);
		expect(indexNowKey(config(true, "another-secret-of-at-least-thirty-two-chars"))).not.toBe(key);
	});
});

describe("telling IndexNow which records changed", () => {
	it("does nothing for a community that has it off", () => {
		expect(createIndexNowNotifier(config(false))).toBeNull();
	});

	it("sends the records' addresses with the community's key and where to read it", async () => {
		const fetcher = fetching();
		const notifier = createIndexNowNotifier(config(true), { fetcher: asFetch(fetcher), pauseMs: 0, say: () => {} })!;
		notifier.add(["ABCD2345", "EFGH2345"]);
		await notifier.idle();

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher.mock.calls[0][0]).toBe("https://api.indexnow.org/indexnow");
		expect(sent(fetcher)).toEqual({
			host: "community.example.org",
			key: indexNowKey(config(true)),
			keyLocation: "https://community.example.org/indexnow-key.txt",
			urlList: ["https://community.example.org/lib/ABCD2345", "https://community.example.org/lib/EFGH2345"],
		});
	});

	// The search indexer calls add between batches: a search engine that never answers must not hold it up.
	it("never waits for the search engine, and keeps one request out at a time", async () => {
		let answer!: (response: Response) => void;
		const fetcher = fetching(() => new Promise<Response>((resolve) => { answer = resolve; }));
		const notifier = createIndexNowNotifier(config(true), { fetcher: asFetch(fetcher), pauseMs: 0, say: () => {} })!;

		notifier.add(["ABCD2345"]);
		notifier.add(["EFGH2345"]);
		notifier.add(["EFGH2345", "IJKL2345"]);
		// Three calls returned at once while the first request is still unanswered.
		expect(fetcher).toHaveBeenCalledTimes(1);

		answer(accepted());
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		// What changed meanwhile goes in one list, each record once.
		expect(sent(fetcher, 1).urlList).toEqual(["https://community.example.org/lib/EFGH2345", "https://community.example.org/lib/IJKL2345"]);
		answer(accepted());
		await notifier.idle();
	});

	it("carries on after a refusal or a failed request, and says what happened", async () => {
		const log = vi.fn();
		const fetcher = fetching()
			.mockRejectedValueOnce(new Error("socket hang up"))
			.mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }))
			.mockResolvedValueOnce(accepted());
		const notifier = createIndexNowNotifier(config(true), { fetcher: asFetch(fetcher), pauseMs: 0, log, say: () => {} })!;

		notifier.add(["ABCD2345"]);
		await notifier.idle();
		notifier.add(["EFGH2345"]);
		await notifier.idle();
		notifier.add(["IJKL2345"]);
		await notifier.idle();

		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(log.mock.calls.map(([message]) => message)).toEqual([
			expect.stringContaining("socket hang up"),
			expect.stringContaining("429"),
		]);
	});

	it("sends at most 10,000 addresses in a request", async () => {
		const fetcher = fetching();
		const notifier = createIndexNowNotifier(config(true), { fetcher: asFetch(fetcher), pauseMs: 0, say: () => {} })!;
		notifier.add(Array.from({ length: 25_000 }, (_, index) => `K${String(index).padStart(7, "0")}`));
		await notifier.idle();

		expect(fetcher.mock.calls.map((_, call) => sent(fetcher, call).urlList.length)).toEqual([10_000, 10_000, 5_000]);
	});
});
