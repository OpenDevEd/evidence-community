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
	it("loads sources without querying or returning the collection catalogue", async () => {
		const orderBy = vi.fn().mockResolvedValue([
			{
				externalScopeKey: "group-42",
				key: "zotero-main",
				provider: "zotero",
				status: "active",
			},
		]);
		const from = vi.fn(() => ({ orderBy }));
		const select = vi.fn(() => ({ from }));

		const snapshot = await getAdminLibrarySnapshot({
			select,
		} as unknown as Database);

		expect(select).toHaveBeenCalledOnce();
		expect(snapshot).toEqual({
			sources: [
				{
					key: "native",
					label: "Native",
					provider: "native",
					readOnly: false,
					status: "active",
					writeback: { enabled: false, supported: false },
				},
				{
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
