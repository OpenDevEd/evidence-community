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
const note = (key: string, version: number, tags: string[], extra: Record<string, unknown> = {}) =>
	record(key, version, { itemType: "Note", note: "<p>Loose note</p>", tags }, extra);
const citesNote = (key: string, parent: string, version: number, html: string) =>
	record(key, version, { itemType: "Note", note: html, tags: ["_cites"] }, { parentSourceRecordKey: parent });

it("reads Zotero citations from _cites notes and ✅_References folders, and follows changes to either", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: SOURCE, provider: "zotero", scopeKind: "group", externalScopeKey: "2129771" });
		let cursor: Record<string, unknown> = {};
		const batch = async (version: number, content: { collections?: unknown[]; items?: unknown[] }, pending = false) => {
			// A batch that leaves work pending is not the sync's last.
			const nextCursor = pending ? { libraryVersion: version - 1, pending: { offset: 1, snapshotSince: 0, targetVersion: version } } : { libraryVersion: version };
			await writeSourceIngestionBatch(db, {
				sourceConnectionKey: SOURCE,
				expectedCursor: cursor,
				nextCursor,
				mappingProfileVersion: "test",
				fetchedAt: new Date(),
				collections: [],
				items: [],
				...content,
			});
			cursor = nextCursor;
		};

		// "Enclosed" holds the citing report; its ✅_References folder holds what it cites, and a loose note that is not a
		// publication. A note under the second report links a publication here; one in another group that a record here
		// says it also is; one in another group, and one in a reader's own library, that only share a key with a record here;
		// and one that is nowhere.
		await batch(1, {
			collections: [
				{ operation: "upsert", sourceRecordKey: "ENCLOSED", remoteVersion: "1", raw: { key: "ENCLOSED" }, data: { name: "Citing report" } },
				{ operation: "upsert", sourceRecordKey: "REFSFLDR", remoteVersion: "1", raw: { key: "REFSFLDR" }, data: { name: "✅_References" }, parentSourceRecordKey: "ENCLOSED" },
			],
			items: [
				publication("CITINGAA", "Citing report", ["ENCLOSED"]),
				publication("CITEDBBB", "First reference", ["REFSFLDR"]),
				publication("CITEDCCC", "Second reference", ["REFSFLDR"]),
				note("LOOSENOT", 1, [], { collections: [{ sourceRecordKey: "REFSFLDR" }] }),
				publication("NOTEDDDD", "Report with a bibliography note"),
				record("ALIASEDA", 1, { itemType: "Report", title: "Also in another group", extra: "KerkoCite.ItemAlsoKnownAs: 2129771:ALIASEDA 2405685:OTHERKEY" }),
				citesNote(
					"NOTEEEEE",
					"NOTEDDDD",
					1,
					'<p><a href="zotero://select/groups/2129771/items/CITEDBBB">First</a> <a href="https://www.zotero.org/groups/2405685/items/OTHERKEY">Copy</a> <a href="zotero://select/groups/9999/items/CITEDCCC">Same key</a> <a href="https://www.zotero.org/groups/2129771/items/ELSEWHER">Elsewhere</a> <a href="zotero://select/library/items/CITEDCCC">Someone\'s own library</a></p>',
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
			`NOTEDDDD → ALIASEDA (source:${SOURCE})`,
			`NOTEDDDD → CITEDBBB (source:${SOURCE})`,
		]);
		const [folderLink] = await db
			.select({ createdAt: itemLink.createdAt })
			.from(itemLink)
			.where(and(eq(itemLink.fromKey, k("CITINGAA")), eq(itemLink.toKey, k("CITEDBBB"))));

		// An editor's own citation is theirs; the next sync only changes the note, not the report it sits under.
		await db.insert(itemLink).values({ fromKey: k("NOTEDDDD"), toKey: k("CITINGAA"), kind: "cites", origin: "manual" });
		const noteNow = citesNote("NOTEEEEE", "NOTEDDDD", 2, '<p><a href="zotero://select/groups/2129771/items/CITEDCCC">Second</a></p>');
		// Citations wait for the sync's last batch.
		await batch(2, { items: [noteNow] }, true);
		expect(await citations()).toContain(`NOTEDDDD → CITEDBBB (source:${SOURCE})`);
		await batch(2, { items: [noteNow] });
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
