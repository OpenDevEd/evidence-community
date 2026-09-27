import { describe, expect, it, vi } from "vitest";

import type { SourceStatus } from "@/lib/source-ingestion/source-status";
import { createSourceStatusReporter } from "@/lib/source-ingestion/status-reporter";

const credential = `els_${"a".repeat(43)}`;

function status(overrides: Partial<SourceStatus> = {}): SourceStatus {
	return {
		changed: 14,
		issues: {},
		key: "zotero-2129771",
		lastSuccessAt: "2026-09-27T12:08:00.000Z",
		provider: "zotero",
		searchFailed: 0,
		searchable: 12_450,
		state: "succeeded",
		...overrides,
	} as SourceStatus;
}

function reporter(read: () => Promise<SourceStatus[]>, fetch: typeof globalThis.fetch) {
	const log = vi.fn();
	const report = createSourceStatusReporter({
		convexSiteUrl: "https://convex-site.example.org",
		fetch,
		libraryId: "lib123",
		log,
		machineCredential: credential,
		now: () => new Date("2026-09-27T12:10:00.000Z"),
		read,
	});
	return { log, report };
}

describe("source status reporter", () => {
	it("posts the snapshot to OpenScholar with the library's machine credential", async () => {
		const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
		const { report } = reporter(async () => [status()], fetch);

		await report();

		const [url, init] = fetch.mock.calls[0]!;
		expect(String(url)).toBe("https://convex-site.example.org/api/v1/evidence-libraries/source-status");
		expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${credential}`);
		expect(JSON.parse(String(init?.body))).toEqual({
			libraryId: "lib123",
			observedAt: "2026-09-27T12:10:00.000Z",
			sources: [status()],
			version: 1,
		});
	});

	it("sends nothing while the status has not changed", async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		const { report } = reporter(async () => [status()], fetch);

		await report();
		await report();

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("retries an unchanged snapshot after a failed post, logging the failure once", async () => {
		const fetch = vi
			.fn(async () => new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response("no route", { status: 404 }))
			.mockResolvedValueOnce(new Response("no route", { status: 404 }));
		const { log, report } = reporter(async () => [status()], fetch);

		await report();
		await report();
		await report();
		await report();

		expect(fetch).toHaveBeenCalledTimes(3);
		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0]![0]).toContain("404");
	});

	it("times the snapshot before reading it, so a slow read never passes for a newer one", async () => {
		const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
		let clock = Date.parse("2026-09-27T12:10:00.000Z");
		const report = createSourceStatusReporter({
			convexSiteUrl: "https://convex-site.example.org",
			fetch,
			libraryId: "lib123",
			machineCredential: credential,
			now: () => new Date(clock),
			read: async () => {
				clock += 30_000;
				return [status()];
			},
		});

		await report();

		expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).observedAt).toBe("2026-09-27T12:10:00.000Z");
	});
});
