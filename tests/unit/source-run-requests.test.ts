import { describe, expect, it, vi } from "vitest";

import { runRequestedSources } from "@/lib/source-ingestion/run-requests";

describe("requested source runs", () => {
	it("runs every requested source, even after one fails, until stopped", async () => {
		const controller = new AbortController();
		const list = vi
			.fn<() => Promise<string[]>>()
			.mockResolvedValueOnce(["zotero-1", "openalex-2"])
			.mockResolvedValue([]);
		const failure = new Error("Zotero request failed with 403");
		const run = vi.fn(async (key: string) => {
			if (key === "zotero-1") throw failure;
		});
		const onError = vi.fn();
		const wait = vi.fn(async () => {
			if (wait.mock.calls.length === 2) controller.abort();
		});

		await runRequestedSources({ list, onError, run, signal: controller.signal, wait });

		expect(run.mock.calls.map(([key]) => key)).toEqual(["zotero-1", "openalex-2"]);
		expect(onError).toHaveBeenCalledWith(failure);
		expect(list).toHaveBeenCalledTimes(2);
	});

	it("keeps checking after the request list cannot be read", async () => {
		const controller = new AbortController();
		const outage = new Error("database unavailable");
		const list = vi
			.fn<() => Promise<string[]>>()
			.mockRejectedValueOnce(outage)
			.mockResolvedValueOnce(["zotero-1"]);
		const run = vi.fn(async () => {
			controller.abort();
		});
		const onError = vi.fn();

		await runRequestedSources({ list, onError, run, signal: controller.signal, wait: async () => undefined });

		expect(onError).toHaveBeenCalledWith(outage);
		expect(run).toHaveBeenCalledWith("zotero-1");
	});

	it("starts a second requested source while the first is still importing", async () => {
		const controller = new AbortController();
		let finishFirst: () => void = () => undefined;
		const first = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const list = vi
			.fn<() => Promise<string[]>>()
			.mockResolvedValueOnce(["zotero-1"])
			.mockResolvedValue(["zotero-1", "openalex-2"]);
		const run = vi.fn((key: string) => (key === "zotero-1" ? first : Promise.resolve()));
		const wait = vi.fn(async () => {
			if (wait.mock.calls.length === 2) {
				controller.abort();
				finishFirst();
			}
		});

		await runRequestedSources({ list, onError: vi.fn(), run, signal: controller.signal, wait });

		expect(run.mock.calls.map(([key]) => key)).toEqual(["zotero-1", "openalex-2"]);
	});
});
