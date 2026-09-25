import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import { itemSourceLink, sourceConnection } from "@opendeved/evidence-library-core";
import { itemLink } from "../../src/db/schema/tables/itemLink";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { writeSourceIngestionBatch } from "../../src/lib/source-ingestion/transactional-writer";

const SOURCE = "zotero-citations";

const record = (sourceRecordKey: string, version: number, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	operation: "upsert" as const,
	sourceRecordKey,
	remoteVersion: String(version),
	raw: { key: sourceRecordKey, version },
	metadata,
	...extra,
});
const publication = (key: string, title: string, folders: string[] = []) =>
	record(key, 1, { itemType: "Report", title }, { collections: folders.map((sourceRecordKey) => ({ sourceRecordKey })) });
const citesNote = (key: string, parent: string, version: number, html: string) =>
	record(key, version, { itemType: "Note", note: html, tags: ["_cites"] }, { parentSourceRecordKey: parent });

it("reads Zotero citations from _cites notes and ✅_References folders, and follows changes to either", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: SOURCE, provider: "zotero", scopeKind: "group", externalScopeKey: "2129771" });
		const batch = (version: number, content: { collections?: unknown[]; items?: unknown[] }) =>
			writeSourceIngestionBatch(db, {
				sourceConnectionKey: SOURCE,
				expectedCursor: version === 1 ? {} : { libraryVersion: version - 1 },
				nextCursor: { libraryVersion: version },
				mappingProfileVersion: "test",
				fetchedAt: new Date(),
				collections: [],
				items: [],
				...content,
			});

		// "Enclosed" holds the citing report; its ✅_References folder holds what it cites. A note under the second report
		// links one publication of this library and one that is not in it.
		await batch(1, {
			collections: [
				{ operation: "upsert", sourceRecordKey: "ENCLOSED", remoteVersion: "1", raw: { key: "ENCLOSED" }, data: { name: "Citing report" } },
				{ operation: "upsert", sourceRecordKey: "REFSFLDR", remoteVersion: "1", raw: { key: "REFSFLDR" }, data: { name: "✅_References" }, parentSourceRecordKey: "ENCLOSED" },
			],
			items: [
				publication("CITINGAA", "Citing report", ["ENCLOSED"]),
				publication("CITEDBBB", "First reference", ["REFSFLDR"]),
				publication("CITEDCCC", "Second reference", ["REFSFLDR"]),
				publication("NOTEDDDD", "Report with a bibliography note"),
				citesNote(
					"NOTEEEEE",
					"NOTEDDDD",
					1,
					'<p><a href="zotero://select/groups/2129771/items/CITEDBBB">First</a> <a href="https://www.zotero.org/groups/2129771/items/ELSEWHER">Elsewhere</a></p>',
				),
			],
		});
		const keys = new Map(
			(await db.select().from(itemSourceLink).where(eq(itemSourceLink.sourceConnectionKey, SOURCE))).map((row) => [row.sourceRecordKey, row.itemKey]),
		);
		const k = (sourceRecordKey: string) => keys.get(sourceRecordKey)!;
		const citations = async () =>
			(await db.select().from(itemLink).where(eq(itemLink.kind, "cites")))
				.map((row) => `${[...keys].find(([, key]) => key === row.fromKey)![0]} → ${[...keys].find(([, key]) => key === row.toKey)![0]} (${row.origin})`)
				.sort();

		expect(await citations()).toEqual([
			`CITINGAA → CITEDBBB (source:${SOURCE})`,
			`CITINGAA → CITEDCCC (source:${SOURCE})`,
			`NOTEDDDD → CITEDBBB (source:${SOURCE})`,
		]);
		const [folderLink] = await db
			.select({ createdAt: itemLink.createdAt })
			.from(itemLink)
			.where(and(eq(itemLink.fromKey, k("CITINGAA")), eq(itemLink.toKey, k("CITEDBBB"))));

		// An editor's own citation is theirs; the next sync only changes the note, not the report it sits under.
		await db.insert(itemLink).values({ fromKey: k("NOTEDDDD"), toKey: k("CITINGAA"), kind: "cites", origin: "manual" });
		await batch(2, {
			items: [citesNote("NOTEEEEE", "NOTEDDDD", 2, '<p><a href="zotero://select/groups/2129771/items/CITEDCCC">Second</a></p>')],
		});
		expect(await citations()).toEqual([
			`CITINGAA → CITEDBBB (source:${SOURCE})`,
			`CITINGAA → CITEDCCC (source:${SOURCE})`,
			`NOTEDDDD → CITEDCCC (source:${SOURCE})`,
			"NOTEDDDD → CITINGAA (manual)",
		]);
		// A citation that did not change is left alone.
		const [unchanged] = await db
			.select({ createdAt: itemLink.createdAt })
			.from(itemLink)
			.where(and(eq(itemLink.fromKey, k("CITINGAA")), eq(itemLink.toKey, k("CITEDBBB"))));
		expect(unchanged!.createdAt).toEqual(folderLink!.createdAt);

		// Taking a record out of the folder, and trashing the note, take their citations away.
		await batch(3, {
			items: [
				record("CITEDCCC", 2, { itemType: "Report", title: "Second reference" }),
				{ operation: "delete", sourceRecordKey: "NOTEEEEE", remoteVersion: "3", raw: { deleted: true } },
			],
		});
		expect(await citations()).toEqual([`CITINGAA → CITEDBBB (source:${SOURCE})`, "NOTEDDDD → CITINGAA (manual)"]);
	});
}, 120_000);
