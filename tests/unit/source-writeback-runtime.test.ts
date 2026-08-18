import { describe, expect, it } from "vitest";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { createSourceWritebackRuntime } from "@/lib/source-writeback/runtime";
import { maximalLibraryConfig } from "../fixtures/library-config";

describe("source writeback runtime", () => {
	it("registers the Zotero adapter and manifest credential resolver", async () => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		const runtime = createSourceWritebackRuntime(config);
		expect(runtime.registry.has("zotero")).toBe(true);
		expect(runtime.registry.has("native")).toBe(false);

		await expect(
			runtime.credentialResolver("zotero-maximal"),
		).resolves.toBe("maximal-zotero-api-key");
	});
});
