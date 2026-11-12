import { describe, expect, it, vi } from "vitest";

import { readLoadedRows } from "@/components/admin/useAdminItemList";
import type { AdminItemListPage, AdminItemListRow } from "@/lib/admin/types";

const row = (key: string) => ({ key }) as AdminItemListRow;
const keys = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

/** A list served fifty rows at a time, as the admin's list is. */
function served(all: string[]) {
	return vi.fn(async (cursor: string | null): Promise<AdminItemListPage> => {
		const from = cursor ? Number(cursor) : 0;
		const to = from + 50;
		return { hasMore: to < all.length, items: all.slice(from, to).map(row), nextCursor: to < all.length ? String(to) : null };
	});
}

describe("reading the rows on screen again", () => {
	it("reads as far as the list had been read", async () => {
		const old = keys("old", 300);
		const read = served(old);
		const { rows, cursor } = await readLoadedRows(read, () => old.slice(0, 100).map(row));
		expect(rows.map(({ key }) => key)).toEqual(old.slice(0, 100));
		expect(cursor).toBe("100");
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("reads on past rows that arrived above, so the rows a person was on are still in the list", async () => {
		const old = keys("old", 300);
		const read = served([...keys("new", 150), ...old]);
		const { rows } = await readLoadedRows(read, () => old.slice(0, 100).map(row));
		expect(rows.map(({ key }) => key)).toEqual([...keys("new", 150), ...old.slice(0, 100)]);
	});

	it("lets the rows on screen go when thousands arrive above them, as in an import", async () => {
		const old = keys("old", 300);
		const read = served([...keys("new", 5_000), ...old]);
		const { rows } = await readLoadedRows(read, () => old.slice(0, 100).map(row));
		expect(rows).toHaveLength(300);
		expect(read).toHaveBeenCalledTimes(6);
	});

	it("reads one page for a list that has nothing on screen yet", async () => {
		const read = served(keys("old", 300));
		const { rows } = await readLoadedRows(read, () => []);
		expect(rows).toHaveLength(50);
	});
});
