import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Database } from "@/db/database-schema";
import { readerCollection, readerCollectionItem, readerCollectionMember, readerUser } from "@/db/schema/tables/reader";
import { createNativeItemDraft, publishItemDraft } from "@/lib/admin/native-item-service";
import { readPickerCollections, readProfileCollections, readSharedCollections } from "@/lib/readers/data";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const OWNER = "reader-owner";
const FRIEND = "reader-friend";
const STRANGER = "reader-stranger";
const SIX = 6;

/** Collection IDs that sort in the order they are numbered, so a test can name the nth oldest. */
const idFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

async function withReaders(verify: (db: Database) => Promise<void>) {
	await withIsolatedPublicationDatabase(async (db: Database) => {
		await db.insert(readerUser).values([OWNER, FRIEND, STRANGER].map((id) => ({ id, name: id.slice(7), email: `${id}@example.org` })));
		await verify(db);
	});
}

const names = (page: { rows: { name: string }[] }) => page.rows.map((row) => row.name);

it("opens the page the chosen collection is on, with collections made in the same instant in ID order", async () => {
	await withReaders(async (db) => {
		// Fourteen collections, oldest first; the fourth and fifth were made in the same instant.
		await db.insert(readerCollection).values(
			Array.from({ length: 14 }, (_, index) => ({ id: idFor(index + 1), userId: OWNER, name: `C${index + 1}`, private: false, createdAt: day(index === 4 ? 3 : index) })),
		);
		const page = (request: { chosenId?: string; page?: number }) =>
			readProfileCollections(db, OWNER, null, { chosenId: request.chosenId ?? null, page: request.page ?? null, pageSize: SIX });

		expect(names(await page({}))).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
		const ninth = await page({ chosenId: idFor(9) });
		expect({ page: ninth.page, pages: ninth.pages, total: ninth.total, chosen: ninth.chosen?.name }).toEqual({ page: 2, pages: 3, total: 14, chosen: "C9" });
		expect(names(ninth)).toEqual(["C7", "C8", "C9", "C10", "C11", "C12"]);
		expect((await page({ chosenId: idFor(14) })).page).toBe(3);
		expect((await page({ chosenId: idFor(6) })).page).toBe(1);
		// A page asked for wins over the chosen collection, which still comes along; one past the end is the last.
		const turned = await page({ chosenId: idFor(14), page: 1 });
		expect({ page: turned.page, chosen: turned.chosen?.name }).toEqual({ page: 1, chosen: "C14" });
		expect((await page({ page: 9 })).page).toBe(3);
	});
});

it("counts and pages only the collections the viewer may see, and tells nothing of a private one to anyone else", async () => {
	await withReaders(async (db) => {
		await db.insert(readerCollection).values([
			...Array.from({ length: 4 }, (_, index) => ({ id: idFor(index + 1), userId: OWNER, name: `Public ${index + 1}`, private: false, createdAt: day(index) })),
			{ id: idFor(5), userId: OWNER, name: "Shared with friend", private: true, createdAt: day(5) },
			{ id: idFor(6), userId: OWNER, name: "Notes", private: true, createdAt: day(6) },
			{ id: idFor(7), userId: OWNER, name: "Drafts", private: true, createdAt: day(7) },
		]);
		await db.insert(readerCollectionMember).values({ collectionId: idFor(5), userId: FRIEND, role: "viewer" });
		const asViewer = (viewer: string | null, chosenId: string | null = null) => readProfileCollections(db, OWNER, viewer, { chosenId, page: null, pageSize: SIX });

		expect((await asViewer(OWNER)).total).toBe(7);
		expect((await asViewer(null)).total).toBe(4);
		const friend = await asViewer(FRIEND, idFor(5));
		expect({ total: friend.total, chosen: friend.chosen?.name, access: friend.chosen?.access, members: friend.chosen?.members.map((member) => member.id) }).toEqual({
			total: 5,
			chosen: "Shared with friend",
			access: "viewer",
			members: [FRIEND],
		});
		const stranger = await asViewer(STRANGER, idFor(6));
		expect({ total: stranger.total, chosen: stranger.chosen, page: stranger.page, names: names(stranger) }).toEqual({
			total: 4,
			chosen: null,
			page: 1,
			names: ["Public 1", "Public 2", "Public 3", "Public 4"],
		});
		// Who a public collection is shared with shows only to its owner and its members.
		expect((await asViewer(STRANGER)).rows.every((row) => row.members.length === 0 && row.access === null)).toBe(true);
	});
});

it("pages the collections shared with a reader, newest share first", async () => {
	await withReaders(async (db) => {
		await db.insert(readerCollection).values(Array.from({ length: 8 }, (_, index) => ({ id: idFor(index + 1), userId: index < 5 ? OWNER : STRANGER, name: `S${index + 1}`, createdAt: day(index) })));
		await db.insert(readerCollectionMember).values(
			Array.from({ length: 8 }, (_, index) => ({ collectionId: idFor(index + 1), userId: FRIEND, role: "editor" as const, createdAt: day(20 + index) })),
		);
		const first = await readSharedCollections(db, FRIEND, { page: 1, pageSize: SIX });
		expect({ pages: first.pages, total: first.total, names: names(first) }).toEqual({ pages: 2, total: 8, names: ["S8", "S7", "S6", "S5", "S4", "S3"] });
		expect(first.rows[0]?.owner.id).toBe(STRANGER);
		expect(names(await readSharedCollections(db, FRIEND, { page: 2, pageSize: SIX }))).toEqual(["S2", "S1"]);
	});
});

it("offers a record the reader's own collections, then the ones they edit by when they were shared, searched literally, and says which hold it", async () => {
	await withReaders(async (db) => {
		const { itemKey } = await createNativeItemDraft(db, { itemType: "Report", title: "Saved report" });
		await publishItemDraft(db, itemKey);
		await db.insert(readerCollection).values([
			{ id: idFor(1), userId: FRIEND, name: "Reading", createdAt: day(1) },
			{ id: idFor(2), userId: FRIEND, name: "50% done", createdAt: day(2) },
			{ id: idFor(3), userId: FRIEND, name: "500 studies", createdAt: day(3) },
			{ id: idFor(4), userId: OWNER, name: "Owner's, edited", createdAt: day(4) },
			{ id: idFor(5), userId: OWNER, name: "Owner's, viewed", createdAt: day(5) },
			// Made first, shared last.
			{ id: idFor(6), userId: OWNER, name: "Shared last", createdAt: day(0) },
		]);
		await db.insert(readerCollectionMember).values([
			{ collectionId: idFor(4), userId: FRIEND, role: "editor", createdAt: day(10) },
			{ collectionId: idFor(5), userId: FRIEND, role: "viewer", createdAt: day(11) },
			{ collectionId: idFor(6), userId: FRIEND, role: "editor", createdAt: day(12) },
		]);
		await db.insert(readerCollectionItem).values({ collectionId: idFor(1), itemKey });
		const pick = (search: string, sort: "recent" | "name" = "recent") => readPickerCollections(db, FRIEND, { search, sort, page: 1, pageSize: 5, itemKey });

		const recent = await pick("");
		// Their own newest first, then the ones they edit, newest share first; the one they only view is not offered.
		expect(names(recent)).toEqual(["500 studies", "50% done", "Reading", "Shared last", "Owner's, edited"]);
		expect(recent.rows.map((row) => row.holdsRecord)).toEqual([false, false, true, false, false]);
		expect(recent.rows[3]).toMatchObject({ access: "editor", owner: { id: OWNER } });
		expect(names(await pick("", "name"))).toEqual(["500 studies", "50% done", "Owner's, edited", "Reading", "Shared last"]);
		// A % in the search is the character, not a wildcard.
		expect(names(await pick("50%"))).toEqual(["50% done"]);
	});
});
