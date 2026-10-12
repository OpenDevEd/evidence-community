import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq, isNull, sql } from "drizzle-orm";
import { outbox, sourceConnection } from "@opendeved/evidence-library-core";
import { libraryConfigSchema } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemOpenAccessLookup } from "@/db/schema/tables/itemOpenAccessLookup";
import { lookUpOpenAccess } from "@/lib/open-access-lookup";
import { generateSearchProjectionPlans } from "@/lib/search-index/projection";
import { OpenAlexClient } from "@/lib/source-ingestion/openalex/client";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const DAY = 24 * 60 * 60_000;

/** OpenAlex as the lookup sees it: the works it holds, by DOI, and the DOIs each request asked about. */
function fakeOpenAlex(works: Record<string, boolean>) {
	const asked: string[][] = [];
	const client = new OpenAlexClient({
		apiKey: "test-key",
		fetch: async (input) => {
			const url = new URL(String(input));
			const dois = url.searchParams.get("filter")!.replace(/^doi:/u, "").split("|");
			asked.push(dois.sort());
			const results = dois.flatMap((doi) =>
				doi in works ? [{ doi: `https://doi.org/${doi}`, open_access: { is_oa: works[doi] } }] : [],
			);
			// Like OpenAlex, `next_cursor` comes only with cursor paging.
			const cursor = url.searchParams.has("cursor") ? { next_cursor: null } : {};
			return Response.json({ meta: { count: results.length, ...cursor }, results });
		},
	});
	return { asked, client };
}

async function openAccessOf(db: Database, keys: string[]) {
	const shown: Record<string, unknown> = {};
	for await (const plan of generateSearchProjectionPlans(db, config, keys.map((entityKey) => ({ entityType: "item" as const, entityKey }))))
		for (const document of plan.documents) shown[document.key] = document.openAccess;
	return shown;
}

async function queuedForSearch(db: Database) {
	const rows = await db
		.select({ key: outbox.entityKey })
		.from(outbox)
		.where(and(eq(outbox.entityType, "item"), isNull(outbox.processedAt)));
	return rows.map(({ key }) => key).sort();
}

const markSearched = (db: Database) => db.update(outbox).set({ processedAt: new Date() });
const edit = (db: Database, key: string, change: { DOI?: string }) =>
	db.update(item).set({ ...change, revision: sql`${item.revision} + 1` }).where(eq(item.key, key));

it("labels a record from its newest OpenAlex work, else from OpenAlex's answer for the DOI it shows, asking only when due", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values([
			{ key: "zotero-oa", provider: "zotero", scopeKind: "group", externalScopeKey: "1" },
			{ key: "openalex-oa", provider: "openalex", scopeKind: "query", config: {} },
			{ key: "openalex-oa-2", provider: "openalex", scopeKind: "query", config: {} },
		]);
		const zotero = await writeSourceIngestionBatch(db, {
			sourceConnectionKey: "zotero-oa",
			expectedCursor: {},
			nextCursor: { version: 1 },
			mappingProfileVersion: "canonical-v1",
			fetchedAt: new Date(),
			items: [
				["OPEN2345", { DOI: "https://doi.org/10.1234/OPEN" }],
				["SHUT2345", { DOI: "10.1234/shut" }],
				["GONE2345", { DOI: "10.1234/gone" }],
				["NONE2345", {}],
				// Zotero keeps some DOIs in Extra; the record shows it all the same.
				["XTRA2345", { extra: "DOI: 10.1234/extra" }],
			].map(([sourceRecordKey, fields]) => ({
				operation: "upsert" as const,
				sourceRecordKey: sourceRecordKey as string,
				remoteVersion: "1",
				raw: { sourceRecordKey },
				metadata: { itemType: "journalArticle", title: sourceRecordKey as string, ...(fields as object) },
			})),
		});
		const [open, shut, gone, none, extra] = ["OPEN2345", "SHUT2345", "GONE2345", "NONE2345", "XTRA2345"].map(
			(key) => zotero.itemKeys[key]!,
		);
		const importWork = (sourceConnectionKey: string, isOa: boolean, cursor: number, fetchedAt: string) =>
			writeSourceIngestionBatch(db, {
				sourceConnectionKey,
				expectedCursor: cursor === 1 ? {} : { v: cursor - 1 },
				nextCursor: { v: cursor },
				mappingProfileVersion: "openalex-v1",
				fetchedAt: new Date(fetchedAt),
				items: mapOpenAlexWork({
					id: "W77",
					title: "An OpenAlex work",
					type: "article",
					doi: "https://doi.org/10.1234/work",
					updated_date: "2026-10-01T00:00:00Z",
					open_access: { is_oa: isOa },
				}).items,
			});
		const fromOpenAlex = (await importWork("openalex-oa", true, 1, "2026-10-01T00:00:00Z")).itemKeys.W77!;
		await markSearched(db);

		const openAlexApi = fakeOpenAlex({ "10.1234/open": true, "10.1234/shut": false, "10.1234/extra": true });
		const now = new Date("2026-10-12T00:00:00Z");
		const lookUp = (at: Date) => lookUpOpenAccess({ database: db, client: openAlexApi.client, config, now: at });
		expect(await lookUp(now)).toBe(5);
		expect(openAlexApi.asked).toEqual([["10.1234/extra", "10.1234/gone", "10.1234/open", "10.1234/shut"]]);
		expect(
			Object.fromEntries((await db.select().from(itemOpenAccessLookup)).map((row) => [row.itemKey, row.isOpenAccess])),
		).toEqual({ [open]: true, [shut]: false, [gone]: null, [none]: null, [extra]: true });
		// A DOI OpenAlex does not know, or no DOI, changes nothing a reader sees.
		expect(await queuedForSearch(db)).toEqual([open, shut, extra].sort());
		expect(await openAccessOf(db, [open, shut, gone, none, extra, fromOpenAlex])).toEqual({
			[open]: true,
			[shut]: false,
			[gone]: null,
			[none]: null,
			[extra]: true,
			[fromOpenAlex]: true,
		});

		// Nothing is due again for a month unless a record changes, and an edit that keeps the DOI asks nothing.
		const nextDay = new Date(now.getTime() + DAY);
		expect(await lookUp(nextDay)).toBe(0);
		await markSearched(db);
		await edit(db, open, {});
		await edit(db, shut, { DOI: "10.1234/moved" });
		expect(await openAccessOf(db, [shut])).toEqual({ [shut]: null });
		expect(await lookUp(nextDay)).toBe(2);
		expect(openAlexApi.asked.slice(1)).toEqual([["10.1234/moved"]]);
		expect(await queuedForSearch(db)).toEqual([]);
		expect(await openAccessOf(db, [open])).toEqual({ [open]: true });
		expect(await lookUp(new Date(now.getTime() + 31 * DAY))).toBe(4);

		// Another search's newer copy of the work is the current one.
		await importWork("openalex-oa-2", false, 1, "2026-10-02T00:00:00Z");
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: false });

		// A copy that becomes the newest, even unchanged, is searched again when it changes the label; one that
		// changes nothing is not.
		await markSearched(db);
		await importWork("openalex-oa", true, 2, "2026-10-03T00:00:00Z");
		expect(await queuedForSearch(db)).toEqual([fromOpenAlex]);
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: true });
		await markSearched(db);
		await importWork("openalex-oa", true, 3, "2026-10-04T00:00:00Z");
		expect(await queuedForSearch(db)).toEqual([]);
	});
});
