import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getLibraryConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: mocks.getLibraryConfig,
}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { getAdminLibrarySnapshot } from "@/lib/admin/library-query-service";
import { minimalLibraryConfig } from "../fixtures/library-config";

beforeEach(() => {
	mocks.getLibraryConfig.mockResolvedValue(
		libraryConfigSchema.parse(minimalLibraryConfig),
	);
});

describe("admin library snapshot", () => {
	it("loads sources with a collection count, never the catalogue itself", async () => {
		const orderBy = vi.fn().mockResolvedValue([
			{
				displayName: null,
				externalScopeKey: "group-42",
				key: "zotero-main",
				provider: "zotero",
				status: "active",
			},
		]);
		const groupBy = vi
			.fn()
			.mockResolvedValue([{ count: 3, sourceConnectionKey: "zotero-main" }]);
		const where = vi.fn(() => ({ groupBy }));
		const from = vi.fn(() => ({ orderBy, where }));
		const select = vi.fn(() => ({ from }));

		const snapshot = await getAdminLibrarySnapshot({
			select,
		} as unknown as Database);

		// One query for the sources, one grouped count over collections.
		expect(select).toHaveBeenCalledTimes(2);
		expect(snapshot).toEqual({
			sources: [
				{
					collectionCount: 0,
					key: "native",
					label: "Native",
					provider: "native",
					readOnly: false,
					status: "active",
					writeback: { enabled: false, supported: false },
				},
				{
					collectionCount: 3,
					key: "zotero-main",
					label: "Zotero · group-42",
					provider: "zotero",
					readOnly: true,
					status: "active",
					writeback: { enabled: false, supported: true },
				},
			],
		});
		expect(snapshot).not.toHaveProperty("collections");
	});
});
