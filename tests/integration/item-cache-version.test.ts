import { outbox } from "@opendeved/evidence-library-core";
import { expect, it, vi } from "vitest";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));

import { readItemVersion } from "@/app/api/cache";
import { getDatabase, getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { createNativeItemDraft, publishItemDraft, unpublishNativeItemWithOutcome } from "@/lib/admin/native-item-service";
import { enqueueItemSearchReprojection } from "@/lib/publication/queue";
import { readPublicItem } from "@/lib/search-index/projection";

const config = libraryConfigSchema.parse(maximalLibraryConfig);

// Item pages are cached under this version, so each committed public change must produce a new one.
it("gives each committed public change to a record a new cache version", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		vi.mocked(getDatabase).mockResolvedValue(db);
		vi.mocked(getDatabaseForConfig).mockResolvedValue(db);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		const { itemKey } = await createNativeItemDraft(db, { itemType: "Report", title: "Cached report" });
		const versions = [await readItemVersion(itemKey)];
		const published = await publishItemDraft(db, itemKey);
		versions.push(await readItemVersion(itemKey));
		// The publication worker re-queues the same revision when a DOI or archive record settles.
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await db.transaction((transaction) => enqueueItemSearchReprojection(transaction, { itemKey, revision: published.revision, queuedAt: new Date() }));
			versions.push(await readItemVersion(itemKey));
		}
		await unpublishNativeItemWithOutcome(db, itemKey);
		versions.push(await readItemVersion(itemKey));

		expect(new Set(versions).size).toBe(versions.length);
		expect(await readPublicItem(db, itemKey, config)).toBeNull();
	});
});

it("changes the version when an earlier transaction commits after a later one", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		vi.mocked(getDatabase).mockResolvedValue(db);
		const row = (revision: number) => ({ entityType: "item" as const, entityKey: "ABCD2345", operation: "upsert" as const, revision });
		await client.query("BEGIN");
		await client.query(`INSERT INTO outbox ("entityType", "entityKey", operation, revision) VALUES ('item', 'ABCD2345', 'upsert', 1)`);
		await db.insert(outbox).values(row(2));
		const beforeEarlierCommit = await readItemVersion("ABCD2345");
		await client.query("COMMIT");
		expect(await readItemVersion("ABCD2345")).not.toBe(beforeEarlierCommit);
	});
});
