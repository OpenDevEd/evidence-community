import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database-schema";
import {
	decodeOpenScholarInstitutionCursor,
	encodeOpenScholarInstitutionCursor,
	parseOpenScholarInstitutionRequest,
} from "@/lib/admin/institution-catalog-contract";
import {
	buildInstitutionCountsQuery,
	listInstitutionCounts,
} from "@/lib/admin/openscholar-institutions";

const dialect = new PgDialect();

/** Compiles the query to the SQL and values Postgres would receive. */
function compile(input: unknown) {
	const request = parseOpenScholarInstitutionRequest(input);
	return dialect.sqlToQuery(
		buildInstitutionCountsQuery(
			request,
			request.cursor
				? decodeOpenScholarInstitutionCursor(request.cursor)
				: null,
		),
	);
}

function databaseReturning(rows: { count: string; name: string }[]) {
	const execute = vi.fn(async () => ({ rows }));
	return {
		database: { execute } as unknown as Database,
		execute,
	};
}

function countRows(count: number, from = 0) {
	return Array.from({ length: count }, (_unused, index) => ({
		count: "2",
		name: `Institution ${String(from + index).padStart(3, "0")}`,
	}));
}

describe("institution page request", () => {
	it("reads the first page by count when nothing is asked for", () => {
		expect(parseOpenScholarInstitutionRequest({})).toEqual({
			cursor: null,
			direction: "desc",
			pageSize: 50,
			query: "",
			sort: "count",
		});
	});

	it("reduces a page size above the cap to the cap", () => {
		expect(
			parseOpenScholarInstitutionRequest({ pageSize: "5000" }).pageSize,
		).toBe(200);
	});

	it("refuses a page size below one", () => {
		expect(() =>
			parseOpenScholarInstitutionRequest({ pageSize: "0" }),
		).toThrow();
	});

	it("refuses a sort it does not know", () => {
		expect(() =>
			parseOpenScholarInstitutionRequest({ sort: "country" }),
		).toThrow();
	});

	it("sorts by name from A to Z unless a direction is given", () => {
		expect(parseOpenScholarInstitutionRequest({ sort: "name" }).direction).toBe(
			"asc",
		);
		expect(
			parseOpenScholarInstitutionRequest({ direction: "desc", sort: "name" })
				.direction,
		).toBe("desc");
	});

	it("refuses a direction it does not know", () => {
		expect(() =>
			parseOpenScholarInstitutionRequest({ direction: "sideways" }),
		).toThrow();
	});

	it("round-trips an opaque cursor", () => {
		const encoded = encodeOpenScholarInstitutionCursor({
			count: 12,
			direction: "desc",
			name: "Amber Institute",
			query: "amber",
			sort: "count",
		});

		expect(encoded).not.toContain("Amber Institute");
		expect(decodeOpenScholarInstitutionCursor(encoded)).toEqual({
			count: 12,
			direction: "desc",
			name: "Amber Institute",
			query: "amber",
			sort: "count",
		});
	});

	it("refuses a cursor that cannot be read", () => {
		expect(() => decodeOpenScholarInstitutionCursor("not-a-cursor")).toThrow(
			/invalid or expired/iu,
		);
	});
});

describe("institution counts query", () => {
	it("asks for one row more than the page and walks by count then name", () => {
		const { params, sql } = compile({});

		expect(sql).toMatch(
			/order by\s+count\(DISTINCT "itemInstitution"\."itemKey"\) desc, "itemInstitution"\."institutionName" asc/iu,
		);
		expect(sql).not.toMatch(/offset/iu);
		expect(sql).not.toMatch(/having/iu);
		expect(params).toContain(51);
	});

	it("reads the maintained projection instead of the records", () => {
		const { sql } = compile({});

		expect(sql).toMatch(/from\s+"itemInstitution"/iu);
		expect(sql).not.toMatch(/from\s+"item"[^I]/iu);
		expect(sql).not.toMatch(/jsonb_array_elements|"creators"/iu);
	});

	it("lets the database fold the case of the search and the stored name", () => {
		const { params, sql } = compile({ query: "%_\\İstanbul" });

		expect(sql).toContain('"institutionName" ILIKE');
		expect(sql).toContain("ESCAPE '\\'");
		// The search word reaches PostgreSQL as typed: lower-casing it in
		// JavaScript would not match the way PostgreSQL folds the stored name.
		expect(params).toContain("%\\%\\_\\\\İstanbul%");
	});

	it("keeps rows with the same count from repeating or going missing", () => {
		const cursor = encodeOpenScholarInstitutionCursor({
			count: 7,
			direction: "desc",
			name: "Amber Institute",
			query: "",
			sort: "count",
		});

		const { params, sql } = compile({ cursor });

		expect(sql).toMatch(/having/iu);
		expect(sql).toContain("count(DISTINCT \"itemInstitution\".\"itemKey\") <");
		expect(sql).toContain("count(DISTINCT \"itemInstitution\".\"itemKey\") =");
		expect(sql).toContain('"institutionName" >');
		expect(params).toContain(7);
		expect(params).toContain("Amber Institute");
	});

	it("walks upwards through the counts when the direction is asc", () => {
		const cursor = encodeOpenScholarInstitutionCursor({
			count: 7,
			direction: "asc",
			name: "Amber Institute",
			query: "",
			sort: "count",
		});

		const { params, sql } = compile({ cursor, direction: "asc" });

		expect(sql).toMatch(/order by\s+count\(DISTINCT "itemInstitution"\."itemKey"\) asc/iu);
		expect(sql).toContain("count(DISTINCT \"itemInstitution\".\"itemKey\") >");
		expect(sql).not.toContain("count(DISTINCT \"itemInstitution\".\"itemKey\") <");
		expect(sql).toContain('"institutionName" >');
		expect(params).toContain(7);
	});

	it("walks backwards through the names when the direction is desc", () => {
		const cursor = encodeOpenScholarInstitutionCursor({
			count: 7,
			direction: "desc",
			name: "Indigo College",
			query: "",
			sort: "name",
		});

		const { sql } = compile({ cursor, direction: "desc", sort: "name" });

		expect(sql).toMatch(/order by\s+"itemInstitution"\."institutionName" desc/iu);
		expect(sql).toContain('"institutionName" <');
	});

	it("orders and walks by name alone when asked to sort by name", () => {
		const cursor = encodeOpenScholarInstitutionCursor({
			count: 7,
			direction: "asc",
			name: "Amber Institute",
			query: "",
			sort: "name",
		});

		const { params, sql } = compile({ cursor, sort: "name" });

		expect(sql).toMatch(
			/order by\s+"itemInstitution"\."institutionName" asc/iu,
		);
		expect(sql).not.toContain("count(DISTINCT \"itemInstitution\".\"itemKey\") desc");
		expect(sql).not.toContain("count(DISTINCT \"itemInstitution\".\"itemKey\") <");
		expect(params).toContain("Amber Institute");
	});
});

describe("institution page", () => {
	it("returns the page with numeric counts and a cursor for the next one", async () => {
		const { database } = databaseReturning([
			{ count: "4", name: "Amber Institute" },
			{ count: "4", name: "Indigo College" },
			{ count: "1", name: "Violet School" },
		]);

		const page = await listInstitutionCounts(database, { pageSize: "2" });

		expect(page.items).toEqual([
			{ count: 4, name: "Amber Institute" },
			{ count: 4, name: "Indigo College" },
		]);
		expect(decodeOpenScholarInstitutionCursor(page.nextCursor!)).toEqual({
			count: 4,
			direction: "desc",
			name: "Indigo College",
			query: "",
			sort: "count",
		});
	});

	it("ends the list when the last page is not full", async () => {
		const { database } = databaseReturning([
			{ count: "1", name: "Violet School" },
		]);

		expect(
			await listInstitutionCounts(database, { pageSize: "2" }),
		).toEqual({
			items: [{ count: 1, name: "Violet School" }],
			nextCursor: null,
		});
	});

	it("returns an empty page when nothing matches the search", async () => {
		const { database } = databaseReturning([]);

		expect(
			await listInstitutionCounts(database, { query: "nobody" }),
		).toEqual({ items: [], nextCursor: null });
	});

	it("never returns more than the capped page size", async () => {
		const { database } = databaseReturning(countRows(201));

		const page = await listInstitutionCounts(database, { pageSize: "5000" });

		expect(page.items).toHaveLength(200);
		expect(page.nextCursor).not.toBeNull();
	});

	it("refuses a cursor saved for a different search", async () => {
		const { database, execute } = databaseReturning([]);
		const cursor = encodeOpenScholarInstitutionCursor({
			count: 4,
			direction: "desc",
			name: "Amber Institute",
			query: "amber",
			sort: "count",
		});

		await expect(
			listInstitutionCounts(database, { cursor, query: "indigo" }),
		).rejects.toThrow(/does not match/iu);
		expect(execute).not.toHaveBeenCalled();
	});

	it("refuses a cursor saved for a different direction", async () => {
		const { database, execute } = databaseReturning([]);
		const cursor = encodeOpenScholarInstitutionCursor({
			count: 4,
			direction: "desc",
			name: "Amber Institute",
			query: "",
			sort: "count",
		});

		await expect(
			listInstitutionCounts(database, { cursor, direction: "asc" }),
		).rejects.toThrow(/does not match/iu);
		expect(execute).not.toHaveBeenCalled();
	});

	it("refuses a cursor saved for a different sort", async () => {
		const { database, execute } = databaseReturning([]);
		const cursor = encodeOpenScholarInstitutionCursor({
			count: 4,
			direction: "desc",
			name: "Amber Institute",
			query: "",
			sort: "count",
		});

		await expect(
			listInstitutionCounts(database, { cursor, sort: "name" }),
		).rejects.toThrow(/does not match/iu);
		expect(execute).not.toHaveBeenCalled();
	});
});
