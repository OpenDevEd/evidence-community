import { expect, it, vi } from "vitest";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { buildCitationRecordsQuery, readPublicLibraryStatus } from "@/lib/library-export-records";

vi.mock("server-only", () => ({}));

it("counts exported publications and their latest update, excluding hidden and unpublished records", async () => {
	const config = libraryConfigSchema.parse(maximalLibraryConfig);
	config.content.tags.hidden = ["hidden"];
	await withIsolatedPublicationDatabase(async (database, client) => {
		expect(await readPublicLibraryStatus(database, config)).toEqual({ totalItems: 0, latestPublicationUpdatedAt: null });
		const rows = [
			["PUBAAAAA", "Report", null, 0, "2026-09-09T09:00:00Z"],
			["PUBBBBBB", "Report", null, 0, "2026-09-10T15:30:00Z"],
			["DELETEDD", "Report", null, 1, "2026-09-11T12:00:00Z"],
			["CHILDDDD", "Attachment", "PUBAAAAA", 0, "2026-09-11T12:00:00Z"],
			["NTEEEEEE", "Note", null, 0, "2026-09-11T12:00:00Z"],
			["HIDDENNN", "Report", null, 0, "2026-09-11T12:00:00Z"],
		];
		for (const [key, itemType, parentItem, deleted, updatedAt] of rows) {
			await client.query('INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, \'native\', $1)', [key]);
			await client.query('INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem", "deleted", "updatedAt") VALUES ($1, \'native\', $1, $2, $3, $4, $5)', [key, itemType, parentItem, deleted, updatedAt]);
		}
		await client.query('INSERT INTO "tag" ("name") VALUES (\'Hidden\')');
		await client.query('INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES (\'HIDDENNN\', \'Hidden\')');
		expect(await readPublicLibraryStatus(database, config)).toEqual({ totalItems: 2, latestPublicationUpdatedAt: new Date("2026-09-10T15:30:00Z") });
		expect((await buildCitationRecordsQuery(database, config, null, 250)).map(record => record.key)).toEqual(["PUBAAAAA", "PUBBBBBB"]);
		await client.query('UPDATE "item" SET "deleted" = 1 WHERE "key" = \'PUBBBBBB\'');
		expect(await readPublicLibraryStatus(database, config)).toEqual({ totalItems: 1, latestPublicationUpdatedAt: new Date("2026-09-09T09:00:00Z") });
	});
}, 120_000);
