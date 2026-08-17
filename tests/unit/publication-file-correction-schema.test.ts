import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	publicationSyncState,
	zenodoFileCorrectionApproval,
	zenodoPublishJournal,
} from "@/db/schema/publication";

describe("Zenodo file correction storage", () => {
	it("stores approval, provider publication time, and journal ownership separately", () => {
		expect(Object.keys(getTableColumns(zenodoFileCorrectionApproval))).toEqual([
			"id",
			"itemKey",
			"provider",
			"environment",
			"doi",
			"fileManifestHash",
			"approvedAt",
			"consumedAt",
			"supersededAt",
			"createdAt",
			"updatedAt",
		]);
		expect(getTableColumns(publicationSyncState)).toHaveProperty(
			"zenodoFirstPublishedAt",
		);
		expect(getTableColumns(zenodoPublishJournal)).toHaveProperty(
			"fileCorrectionApprovalId",
		);
	});
});
