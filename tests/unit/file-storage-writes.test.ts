import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseFileStorage } from "@/lib/admin/file-storage";

const storage = () =>
	createSupabaseFileStorage({
		url: "http://storage:5000",
		serviceRoleKey: "service-role-key",
		privateBucket: "library-private",
		publicBucket: "library-public",
		maxPdfBytes: 100_000_000,
	});

function answers(...statuses: number[]) {
	const fetch = vi.fn(async () => {
		const status = statuses.shift() ?? 200;
		return status === 200
			? Response.json({ Key: "library-public/a.pdf", Id: "1" })
			: Response.json({ statusCode: String(status), code: status === 423 ? "LockTimeout" : "InternalError", error: "Error", message: "upstream failed" }, { status });
	});
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("storage writes", () => {
	it("tries a write again when the storage service fails for a moment or holds a lock", async () => {
		vi.useFakeTimers();
		const fetch = answers(502, 423);
		const upload = storage().uploadPublic("a.pdf", new Uint8Array([1]), "application/pdf");
		await vi.runAllTimersAsync();
		await expect(upload).resolves.toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("fails at once on a refusal, and says what the service answered", async () => {
		const fetch = answers(400);
		await expect(storage().uploadPublic("a.pdf", new Uint8Array([1]), "application/pdf")).rejects.toThrow(/HTTP 400/u);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("says why a write got no response", async () => {
		vi.useFakeTimers();
		const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed", { cause: reset }); }));
		const upload = storage().uploadPublic("a.pdf", new Uint8Array([1]), "application/pdf");
		const failed = expect(upload).rejects.toThrow(/no response: .*fetch failed <- read ECONNRESET \[ECONNRESET\]/u);
		await vi.runAllTimersAsync();
		await failed;
	});

	it("gives up after three tries", async () => {
		vi.useFakeTimers();
		const fetch = answers(503, 503, 503, 503);
		const upload = storage().uploadPublic("a.pdf", new Uint8Array([1]), "application/pdf");
		const failed = expect(upload).rejects.toThrow(/HTTP 503 InternalError/u);
		await vi.runAllTimersAsync();
		await failed;
		expect(fetch).toHaveBeenCalledTimes(3);
	});
});
