import { afterEach, describe, expect, it, vi } from "vitest";

import { createSourceWritebackRuntime } from "@/lib/source-writeback/runtime";

describe("source writeback runtime", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("registers the Zotero adapter and environment credential resolver", async () => {
		const runtime = createSourceWritebackRuntime();
		expect(runtime.registry.has("zotero")).toBe(true);
		expect(runtime.registry.has("native")).toBe(false);

		vi.stubEnv("TEST_SOURCE_WRITEBACK_CREDENTIAL", "test-secret");
		await expect(
			runtime.credentialResolver("env:TEST_SOURCE_WRITEBACK_CREDENTIAL"),
		).resolves.toBe("test-secret");
	});
});
