import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
vi.mock("undici", async (importOriginal) => ({ ...(await importOriginal<typeof import("undici")>()), fetch: vi.fn() }));

import { ReadableStream } from "node:stream/web";
import { fetch as transport, Response } from "undici";
import { lookup } from "node:dns/promises";
import { fetchPublicFile } from "@/lib/public-fetch";

/** A body that sends `chunks` pieces, `gapMs` apart, and then either ends or goes quiet. */
function trickle(chunks: number, gapMs: number, end: boolean) {
	let sent = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (sent === chunks) {
				if (end) controller.close();
				else await new Promise(() => {});
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, gapMs));
			sent++;
			controller.enqueue(new Uint8Array([sent]));
		},
	});
}

describe("fetchPublicFile idle timeout", () => {
	it("stops a download that goes quiet, well before its time limit", async () => {
		vi.mocked(transport).mockResolvedValueOnce(new Response(trickle(1, 0, false)));
		const started = Date.now();
		await expect(
			fetchPublicFile(new URL("https://publisher.example/paper.pdf"), { accept: "application/pdf", timeoutMs: 10_000, idleTimeoutMs: 50 }),
		).rejects.toThrow("Download stalled");
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it("stops waiting on an address lookup that never answers", async () => {
		vi.mocked(lookup).mockImplementationOnce(() => new Promise(() => {}));
		await expect(
			fetchPublicFile(new URL("https://publisher.example/paper.pdf"), { accept: "application/pdf", timeoutMs: 10_000, idleTimeoutMs: 50 }),
		).rejects.toThrow("Download stalled");
	});

	it("lets a slow download finish while it keeps sending", async () => {
		vi.mocked(transport).mockResolvedValueOnce(new Response(trickle(8, 30, true)));
		const { data } = await fetchPublicFile(new URL("https://publisher.example/paper.pdf"), {
			accept: "application/pdf",
			timeoutMs: 10_000,
			idleTimeoutMs: 100,
		});
		expect([...data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});
});
