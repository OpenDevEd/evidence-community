import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq, isNull, sql } from "drizzle-orm";
import { outbox, sourceConnection } from "@opendeved/evidence-library-core";
import { libraryConfigSchema } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemOpenAccessLookup } from "@/db/schema/tables/itemOpenAccessLookup";
import { readOpenAccessFromSources } from "@/lib/search-index/open-access";
import { openItemDraft, publishItemDraft, saveItemDraft } from "@/lib/admin/native-item-service";
import { lookUpOpenAccess } from "@/lib/open-access-lookup";
import { generateSearchProjectionPlans } from "@/lib/search-index/projection";
import { reconcileConfiguredSources } from "@/lib/source-ingestion/configuration";
import { OpenAlexClient } from "@/lib/source-ingestion/openalex/client";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { reconcileOpenAlexMemberships } from "@/lib/source-ingestion/openalex/reconciliation";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const policy = { writebackConfig: config };
const DAY = 24 * 60 * 60_000;
const openAlexSettings = {
	name: "AI in education",
	searchUrl: "/results/saved-search-1",
	approvedQuery: { version: "v1", approvedAt: "2026-09-24T10:00:00Z", query: { search: "AI in education" } },
	downloadPdfs: false,
};

/** OpenAlex as the lookup sees it: the works it holds for each DOI, and the DOIs each lookup asked about. */
function fakeOpenAlex(works: Record<string, boolean[]>) {
	const asked: string[][] = [];
	const client = new OpenAlexClient({
		apiKey: "test-key",
		fetch: async (input) => {
			const url = new URL(String(input));
			const dois = url.searchParams.get("filter")!.replace(/^doi:/u, "").split("|").sort();
			const cursor = url.searchParams.get("cursor");
			if (cursor !== "*" && cursor !== null) return pageOf(works, dois, Number(cursor));
			asked.push(dois);
			return pageOf(works, dois, 0, cursor !== null);
		},
	});
	return { asked, client };
}

/** Two works a page, so DOIs that share works take more than one. Like OpenAlex, `next_cursor` comes only with a cursor. */
function pageOf(works: Record<string, boolean[]>, dois: string[], start: number, paged = true) {
	const results = dois.flatMap((doi) =>
		(works[doi] ?? []).map((isOa) => ({ doi: `https://doi.org/${doi}`, open_access: { is_oa: isOa } })),
	);
	const next = start + 2 < results.length ? String(start + 2) : null;
	const meta = paged ? { count: results.length, next_cursor: next } : { count: results.length };
	return Response.json({ meta, results: results.slice(start, start + 2) });
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
				["TWCE2345", { DOI: "10.1234/twice" }],
			].map(([sourceRecordKey, fields]) => ({
				operation: "upsert" as const,
				sourceRecordKey: sourceRecordKey as string,
				remoteVersion: "1",
				raw: { sourceRecordKey },
				metadata: { itemType: "journalArticle", title: sourceRecordKey as string, ...(fields as object) },
			})),
		});
		const [open, shut, gone, none, extra, twice] = ["OPEN2345", "SHUT2345", "GONE2345", "NONE2345", "XTRA2345", "TWCE2345"].map(
			(key) => zotero.itemKeys[key]!,
		);
		const importWork = (
			sourceConnectionKey: string,
			isOa: boolean,
			cursor: number,
			fetchedAt: string,
			updatedDate = "2026-10-01T00:00:00Z",
		) =>
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
					updated_date: updatedDate,
					open_access: { is_oa: isOa },
				}).items,
			});
		const fromOpenAlex = (await importWork("openalex-oa", true, 1, "2026-10-01T00:00:00Z")).itemKeys.W77!;
		await markSearched(db);

		// OpenAlex holds three works with one DOI, and only the last, on a later page, is open.
		const openAlexApi = fakeOpenAlex({
			"10.1234/open": [true],
			"10.1234/shut": [false],
			"10.1234/extra": [true],
			"10.1234/twice": [false, false, true],
			"10.5072/zenodo.1": [true],
		});
		const now = new Date("2026-10-12T00:00:00Z");
		const lookUp = (at: Date) => lookUpOpenAccess({ database: db, client: openAlexApi.client, config, now: at });
		expect(await lookUp(now)).toBe(6);
		expect(openAlexApi.asked).toEqual([["10.1234/extra", "10.1234/gone", "10.1234/open", "10.1234/shut", "10.1234/twice"]]);
		expect(
			Object.fromEntries((await db.select().from(itemOpenAccessLookup)).map((row) => [row.itemKey, row.isOpenAccess])),
		).toEqual({ [open]: true, [shut]: false, [gone]: null, [none]: null, [extra]: true, [twice]: true });
		// A DOI OpenAlex does not know, or no DOI, changes nothing a reader sees.
		expect(await queuedForSearch(db)).toEqual([open, shut, extra, twice].sort());
		expect(await openAccessOf(db, [open, shut, gone, none, extra, twice, fromOpenAlex])).toEqual({
			[open]: true,
			[shut]: false,
			[gone]: null,
			[none]: null,
			[extra]: true,
			[twice]: true,
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

		// A DOI the library mints for its own deposit takes no new revision; the record is looked at again all the same.
		await db.execute(sql`INSERT INTO "publicationTarget" ("itemKey", provider, environment, "identifierPolicy", "requestedBy")
			VALUES (${none}, 'zenodo', 'sandbox', 'mint-zenodo', 'qa')`);
		await db.execute(sql`INSERT INTO "publicationIdentifier"
			("itemKey", registrar, environment, role, doi, ownership, lifecycle, "isCurrent", "verifiedAt", "updatedAt")
			VALUES (${none}, 'zenodo', 'sandbox', 'version', '10.5072/zenodo.1', 'managed', 'verified', true, now(), ${new Date(nextDay.getTime() + 1_000)})`);
		const minted = new Date(nextDay.getTime() + 2_000);
		expect(await lookUp(minted)).toBe(1);
		expect(openAlexApi.asked.at(-1)).toEqual(["10.5072/zenodo.1"]);
		expect(await openAccessOf(db, [none])).toEqual({ [none]: true });
		expect(await lookUp(minted)).toBe(0);
		expect(await lookUp(new Date(now.getTime() + 31 * DAY))).toBe(4);

		// Another search's copy of the same OpenAlex version, fetched later, is the current one.
		await importWork("openalex-oa-2", false, 1, "2026-10-02T00:00:00Z");
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: false });

		// A copy that becomes the current one, even unchanged, is searched again when it changes the label; one that
		// changes nothing is not.
		await markSearched(db);
		await importWork("openalex-oa", true, 2, "2026-10-03T00:00:00Z");
		expect(await queuedForSearch(db)).toEqual([fromOpenAlex]);
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: true });
		await markSearched(db);
		await importWork("openalex-oa", true, 3, "2026-10-04T00:00:00Z");
		expect(await queuedForSearch(db)).toEqual([]);

		// A newer OpenAlex version outranks an older one fetched later.
		await importWork("openalex-oa-2", false, 2, "2026-10-05T00:00:00Z", "2026-10-05T00:00:00Z");
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: false });
		await markSearched(db);
		await importWork("openalex-oa", true, 4, "2026-10-06T00:00:00Z");
		expect(await queuedForSearch(db)).toEqual([]);
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: false });

		// Once a search stops finding the work, its copy no longer counts, and the record another search keeps is
		// searched again.
		await reconcileOpenAlexMemberships(db, {
			sourceConnectionKey: "openalex-oa-2",
			configuration: {},
			cursor: { v: 2 },
			startedAt: "2026-10-07T00:00:00Z",
		});
		expect(await queuedForSearch(db)).toEqual([fromOpenAlex]);
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: true });

		// A source taken out of the library stops counting, and one put back counts again; its records are searched again
		// both times.
		await markSearched(db);
		await reconcileConfiguredSources(db, []);
		expect(await queuedForSearch(db)).toEqual([fromOpenAlex]);
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: null });
		await markSearched(db);
		const { sources } = libraryConfigSchema.parse({
			...maximalLibraryConfig,
			sources: [{ key: "openalex-oa", provider: "openalex", apiKey: "test-key", settings: openAlexSettings }],
		});
		await reconcileConfiguredSources(db, sources);
		expect(await queuedForSearch(db)).toEqual([fromOpenAlex]);
		expect(await openAccessOf(db, [fromOpenAlex])).toEqual({ [fromOpenAlex]: true });
	});
});

it("puts an editor's choice before OpenAlex, keeps it through source sync, and asks OpenAlex nothing about it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values([
			{ key: "zotero-maximal", provider: "zotero", scopeKind: "group", externalScopeKey: "6632364" },
			{ key: "openalex-choice", provider: "openalex", scopeKind: "query", config: {} },
		]);
		const importWork = (cursor: number, title = "An open OpenAlex work") =>
			writeSourceIngestionBatch(db, {
				sourceConnectionKey: "openalex-choice",
				expectedCursor: cursor === 1 ? {} : { v: cursor - 1 },
				nextCursor: { v: cursor },
				mappingProfileVersion: "openalex-v1",
				fetchedAt: new Date(),
				items: mapOpenAlexWork({
					id: "W88",
					title: title,
					type: "article",
					doi: "https://doi.org/10.1234/chosen",
					updated_date: `2026-10-0${cursor}T00:00:00Z`,
					open_access: { is_oa: true },
				}).items,
			});
		const work = (await importWork(1)).itemKeys.W88!;
		const zotero = (
			await writeSourceIngestionBatch(db, {
				sourceConnectionKey: "zotero-maximal",
				expectedCursor: {},
				nextCursor: { version: 1 },
				mappingProfileVersion: "canonical-v1",
				fetchedAt: new Date(),
				items: [
					{
						operation: "upsert",
						sourceRecordKey: "DCDE2345",
						remoteVersion: "1",
						raw: {},
						metadata: { itemType: "journalArticle", title: "Decided", DOI: "10.1234/decided" },
					},
				],
			})
		).itemKeys.DCDE2345!;
		const choose = async (key: string, openAccess: boolean | null) => {
			const draft = await openItemDraft(db, key, policy);
			await saveItemDraft(
				db,
				{
					itemKey: key,
					expectedDraftGeneration: draft.generation,
					expectedDraftRevision: draft.draftRevision,
					expectedPayload: draft.payload,
					payload: { ...draft.payload, openAccess },
				},
				policy,
			);
			await publishItemDraft(db, key, policy);
		};

		// An editor marks the open OpenAlex work closed: readers see closed, the admin still sees what OpenAlex says, and
		// the next sync of the work keeps the choice.
		await choose(work, false);
		expect(await openAccessOf(db, [work])).toEqual({ [work]: false });
		expect(await readOpenAccessFromSources(db, work)).toBe(true);
		await importWork(2, "An open OpenAlex work, revised");
		expect((await db.select().from(item).where(eq(item.key, work)))[0]?.title).toBe("An open OpenAlex work, revised");
		expect(await openAccessOf(db, [work])).toEqual({ [work]: false });

		// A record an editor decided is not looked up.
		await choose(zotero, true);
		const openAlexApi = fakeOpenAlex({ "10.1234/decided": [false] });
		expect(await lookUpOpenAccess({ database: db, client: openAlexApi.client, config, now: new Date() })).toBe(0);
		expect(openAlexApi.asked).toEqual([]);
		expect(await openAccessOf(db, [zotero])).toEqual({ [zotero]: true });

		// Left to OpenAlex again, the work shows what OpenAlex says, and the record is looked up.
		await choose(work, null);
		await choose(zotero, null);
		expect(await openAccessOf(db, [work])).toEqual({ [work]: true });
		expect(await lookUpOpenAccess({ database: db, client: openAlexApi.client, config, now: new Date() })).toBe(1);
		expect(await openAccessOf(db, [zotero])).toEqual({ [zotero]: false });

		// Marked open again, the record still tells the admin what OpenAlex said about its DOI.
		await choose(zotero, true);
		expect(await openAccessOf(db, [zotero])).toEqual({ [zotero]: true });
		expect(await readOpenAccessFromSources(db, zotero)).toBe(false);
	});
}, 120_000);
