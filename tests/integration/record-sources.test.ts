import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq, isNull } from "drizzle-orm";
import { outbox, sourceConnection } from "@opendeved/evidence-library-core";
import { item } from "@/db/schema/tables/item";
import { sourceSnapshot } from "@/db/schema/source";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { generateSearchProjectionPlans } from "@/lib/search-index/projection";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { createNativeItemDraft, publishItemDraft } from "@/lib/admin/native-item-service";
import { setAdminItemWritebackSources } from "@/lib/admin/source-writeback-service";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const settings = (name: string) => ({
	name,
	searchUrl: "/results/saved-search-1",
	approvedQuery: { version: "v1", approvedAt: "2026-10-20T10:00:00Z", query: { search: name } },
	downloadPdfs: false,
});
const work = { id: "https://openalex.org/W1", type: "article", title: "Housing wealth and mobility", updated_date: "2026-10-20T10:00:00Z" };

it("indexes every source that holds a record, and searches it again when a source takes it up or lets it go", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values(
			[["oa-core", "Wealth and mobility"], ["oa-housing", "Community Infrastructure"]].map(([key, name]) => ({
				key, provider: "openalex" as const, scopeKind: "query" as const, displayName: name, config: settings(name),
			})),
		);
		const run = async (key: string, results: unknown[]) => {
			const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, key));
			await syncOpenAlexSource(
				{ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} },
				{ fetch: async () => Response.json({ meta: { count: results.length, next_cursor: null }, results }), sleep: async () => {} },
			);
		};
		const recordKey = async () => (await db.select({ key: item.key }).from(item).where(eq(item.sourceRecordKey, "W1")))[0]!.key;
		const sourcesOf = async (key: string) => {
			const documents = [];
			for await (const plan of generateSearchProjectionPlans(db, config, [{ entityType: "item", entityKey: key }])) documents.push(...plan.documents);
			return documents[0]?.sources;
		};
		const searchedAgain = async (key: string) =>
			(await db.select().from(outbox).where(and(eq(outbox.entityKey, key), isNull(outbox.processedAt)))).length > 0;
		const markSearched = (key: string) => db.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.entityKey, key));

		await run("oa-core", [work]);
		const key = await recordKey();
		expect(await sourcesOf(key)).toEqual(["oa-core"]);

		// The second search finds the same work, unchanged: one record, now in both sources.
		await markSearched(key);
		await run("oa-housing", [work]);
		expect(await recordKey()).toBe(key);
		expect(await searchedAgain(key)).toBe(true);
		expect(await sourcesOf(key)).toEqual(["oa-core", "oa-housing"]);

		// The second search's weekly full scan no longer finds it: the record stays, held by the first alone.
		await markSearched(key);
		const [housing] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-housing"));
		await db.update(sourceConnection)
			.set({ syncCursor: { ...(housing!.syncCursor as Record<string, unknown>), reconciledAt: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString() } })
			.where(eq(sourceConnection.key, "oa-housing"));
		await db.update(sourceSnapshot).set({ fetchedAt: new Date("2020-01-01T00:00:00Z") }).where(eq(sourceSnapshot.sourceConnectionKey, "oa-housing"));
		await run("oa-housing", []);
		expect(await searchedAgain(key)).toBe(true);
		expect(await sourcesOf(key)).toEqual(["oa-core"]);
	});
}, 120_000);

it("searches a record again once an editor sends it to a source, which then holds it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "zotero-maximal", provider: "zotero", scopeKind: "group", externalScopeKey: "6632364" });
		const created = await createNativeItemDraft(db, { itemType: "Report", title: "Wealth taxes" });
		await publishItemDraft(db, created.itemKey);
		await db.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.entityKey, created.itemKey));

		await setAdminItemWritebackSources(db, created.itemKey, ["zotero-maximal"], config);

		const waiting = await db.select().from(outbox).where(and(eq(outbox.entityKey, created.itemKey), isNull(outbox.processedAt)));
		expect(waiting).toHaveLength(1);
		const documents = [];
		for await (const plan of generateSearchProjectionPlans(db, config, [{ entityType: "item", entityKey: created.itemKey }])) documents.push(...plan.documents);
		expect(documents[0]?.sources).toEqual(["zotero-maximal"]);
	});
});
