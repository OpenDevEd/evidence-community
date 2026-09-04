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
import { sourceRecordIssue } from "@/db/schema/source";
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
		const leftJoin = vi.fn().mockResolvedValue([
			{
				activeRunStartedAt: null,
				lastError: null,
				lastFailureAt: null,
				lastResult: { records: 12 },
				lastSuccessAt: new Date("2026-09-04T10:00:00Z"),
				leaseExpiresAt: null,
				sourceConnectionKey: "zotero-main",
			},
		]);
		const issueGroupBy = vi
			.fn()
			.mockResolvedValue([{ count: 2, sourceConnectionKey: "zotero-main" }]);
		const from = vi.fn((table: unknown) => ({
			leftJoin,
			orderBy,
			where:
				table === sourceRecordIssue
					? () => ({ groupBy: issueGroupBy })
					: where,
		}));
		const select = vi.fn(() => ({ from }));

		const snapshot = await getAdminLibrarySnapshot({
			select,
		} as unknown as Database);

		// Sources, collection counts, sync state, and issue counts. Never the
		// catalogue itself.
		expect(select).toHaveBeenCalledTimes(4);
		expect(snapshot).toEqual({
			sources: [
				{
					collectionCount: 0,
					key: "native",
					label: "Native",
					provider: "native",
					readOnly: false,
					status: "active",
					sync: null,
					writeback: { enabled: false, supported: false },
				},
				{
					collectionCount: 3,
					key: "zotero-main",
					label: "Zotero · group-42",
					provider: "zotero",
					readOnly: true,
					status: "active",
					sync: {
						issueCount: 2,
						lastError: null,
						lastFailureAt: null,
						lastRecords: 12,
						lastSuccessAt: "2026-09-04T10:00:00.000Z",
						processed: null,
						runningSince: null,
						status: "succeeded",
					},
					writeback: { enabled: false, supported: true },
				},
			],
		});
		expect(snapshot).not.toHaveProperty("collections");
	});
});
