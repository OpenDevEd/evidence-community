import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getLibraryConfig: vi.fn(),
	readSourceStatuses: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: mocks.getLibraryConfig,
}));
vi.mock("@/lib/source-ingestion/source-status", () => ({
	readSourceStatuses: mocks.readSourceStatuses,
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
				scopeKind: "group",
				status: "active",
			},
		]);
		const groupBy = vi
			.fn()
			.mockResolvedValue([{ count: 3, sourceConnectionKey: "zotero-main" }]);
		const where = vi.fn(() => ({ groupBy }));
		const activity = {
			changed: 4,
			issues: { zotero_fields_dropped: 2 },
			key: "zotero-main",
			lastSuccessAt: "2026-09-04T10:00:00.000Z",
			provider: "zotero",
			searchFailed: 0,
			searchable: 12,
			state: "succeeded",
		};
		mocks.readSourceStatuses.mockResolvedValue([activity]);
		const from = vi.fn(() => ({ orderBy, where }));
		const select = vi.fn(() => ({ from }));

		const snapshot = await getAdminLibrarySnapshot({
			select,
		} as unknown as Database);

		// Sources and collection counts; the status reader brings import state.
		// Never the catalogue itself.
		expect(select).toHaveBeenCalledTimes(2);
		expect(mocks.readSourceStatuses).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ hiddenTags: expect.any(Array) }),
		);
		expect(snapshot).toEqual({
			sources: [
				{
					activity: null,
					collectionCount: 0,
					externalScopeKey: null,
					key: "native",
					label: "Native",
					provider: "native",
					readOnly: false,
					scopeKind: "library",
					status: "active",
					writeback: { enabled: false, supported: false },
				},
				{
					activity,
					collectionCount: 3,
					externalScopeKey: "group-42",
					key: "zotero-main",
					label: expect.stringMatching(/Zotero.*group-42/),
					provider: "zotero",
					readOnly: true,
					scopeKind: "group",
					status: "active",
					writeback: { enabled: false, supported: true },
				},
			],
		});
		expect(snapshot).not.toHaveProperty("collections");
	});
});
