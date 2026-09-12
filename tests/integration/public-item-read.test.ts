import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
vi.mock("@/app/api/cache", () => ({ getCachedCollections: async () => [] }));
// An item page must work even when its search document does not exist yet.
vi.mock("@/lib/meilisearch", () => ({
	getMeilisearchForConfig: async () => ({ index: { getDocument: async () => { throw { response: { status: 404 } }; } } }),
}));

import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { GET } from "@/app/api/item/[key]/route";
import { createNativeItemDraft } from "@/lib/admin/native-item-service";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
config.content.tags.hidden = ["hidden"];

function read(key: string) {
	return GET(new NextRequest(`https://library.example.org/api/item/${key}`), { params: Promise.resolve({ key }) });
}

it("reads committed publications before indexing, and immediately respects edits, removal and hidden records", async () => {
	await withIsolatedPublicationDatabase(async (database, client) => {
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		const draft = await createNativeItemDraft(database, { itemType: "Report", title: "Private working draft" });
		expect((await read(draft.itemKey)).status).toBe(404);
		const rows = [
			["PUBAAAAA", "Report", null, 0, "Published title"],
			["CHILDDDD", "Attachment", "PUBAAAAA", 0, "Published PDF"],
			["SECRETAA", "Attachment", "PUBAAAAA", 0, "Hidden PDF"],
			["DELETEDD", "Attachment", "PUBAAAAA", 1, "Removed PDF"],
			["HIDDENNN", "Report", null, 0, "Hidden publication"],
		];
		for (const [key, itemType, parentItem, deleted, title] of rows) {
			await client.query('INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, \'native\', $1)', [key]);
			await client.query('INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem", "deleted", "title", "fullTextPDF") VALUES ($1, \'native\', $1, $2, $3, $4, $5, $6)', [key, itemType, parentItem, deleted, title, parentItem ? `${title} text` : null]);
		}
		await client.query('INSERT INTO "tag" ("name") VALUES (\'Hidden\')');
		await client.query('INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES (\'HIDDENNN\', \'Hidden\'), (\'SECRETAA\', \'Hidden\')');
		await client.query('INSERT INTO "itemInstitution" ("itemKey", "institutionName") VALUES (\'PUBAAAAA\', \'Learning Lab\')');
		await client.query('INSERT INTO "itemLink" ("fromKey", "toKey", "kind", "origin") VALUES (\'PUBAAAAA\', \'HIDDENNN\', \'related\', \'manual\')');
		const response = await read("PUBAAAAA");
		expect(response.status).toBe(200);
		const publication = (await response.json()).item;
		expect(publication.title).toBe("Published title");
		expect(publication.institution).toEqual(["Learning Lab"]);
		expect(publication.links).toEqual({ cites: [], citedBy: [], related: [] });
		expect(publication.attachmentsData.map((attachment: { key: string }) => attachment.key)).toEqual(["CHILDDDD"]);
		expect(publication.fullTextPDFs).toEqual([{ key: "CHILDDDD", fullTextPDF: [{ page: 1, text: "Published PDF text" }] }]);
		expect(response.headers.get("cache-control")).toBe("no-store");
		for (const key of ["HIDDENNN", "CHILDDDD", "DELETEDD", "MISSINGG"]) {
			const missing = await read(key);
			expect(missing.status).toBe(404);
			expect((await missing.json()).item).toBeNull();
		}
		await client.query('UPDATE "item" SET "title" = \'Revised title\', "revision" = "revision" + 1 WHERE "key" = \'PUBAAAAA\'');
		expect((await (await read("PUBAAAAA")).json()).item.title).toBe("Revised title");
		await client.query('UPDATE "item" SET "deleted" = 1 WHERE "key" = \'PUBAAAAA\'');
		expect((await read("PUBAAAAA")).status).toBe(404);
	});
}, 120_000);

it("reports an unavailable database as a retryable failure instead of a missing publication", async () => {
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	vi.mocked(getDatabaseForConfig).mockRejectedValue(new Error("Database unavailable"));
	const response = await read("PUBAAAAA");
	expect(response.status).toBe(503);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect((await read("invalid")).status).toBe(400);
});
