import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import type { Database } from "@/db/database-schema";

import type { AdminItemListRow } from "@/lib/admin/types";

import {
	applySubmittedSnapshots,
	decodeAdminItemCursor,
	encodeAdminItemCursor,
	buildAdminItemListQuery,
	getAdminItemListPage,
} from "@/lib/admin/item-list-query";

describe("admin item list query", () => {
	it("round-trips an opaque, versioned cursor", () => {
		const encoded = encodeAdminItemCursor({
			column: "updated",
			direction: "desc",
			key: "AB12CD34",
			nullRank: 0,
			value: "2026-07-31T09:10:11.000Z",
		});

		expect(encoded).not.toContain("AB12CD34");
		expect(decodeAdminItemCursor(encoded)).toEqual({
			column: "updated",
			direction: "desc",
			key: "AB12CD34",
			nullRank: 0,
			value: "2026-07-31T09:10:11.000Z",
		});
	});

	it("rejects a cursor from a different sort", async () => {
		const cursor = encodeAdminItemCursor({
			column: "title",
			direction: "asc",
			key: "AB12CD34",
			nullRank: 0,
			value: "example",
		});
		const database = {
			execute() {
				throw new Error("query should not execute");
			},
		} as unknown as Database;

		await expect(
			getAdminItemListPage(database, {
				cursor,
				sorting: [{ column: "year", direction: "desc" }],
			}),
		).rejects.toThrow("does not match the current sort");
	});

	it("queries the maintained projection with keyset pagination", async () => {
		const database = drizzle({
			connection: "postgresql://unused",
		}) as unknown as Database;
		const { query } = buildAdminItemListQuery(database, {
			filters: [
				{ column: "state", operator: "anyOf", value: ["draft"] },
			],
			search: "teacher",
			sorting: [{ column: "updated", direction: "desc" }],
		});
		const statement = query.toSQL().sql;

		expect(statement).toContain('from "adminItemListProjection"');
		expect(statement).not.toContain(" offset ");
		expect(statement).toContain('"searchText"');
	});

	it("treats wildcard characters in contains searches as literals", () => {
		const database = drizzle({
			connection: "postgresql://unused",
		}) as unknown as Database;
		const { query } = buildAdminItemListQuery(database, {
			filters: [
				{ column: "title", operator: "contains", value: "%_\\" },
			],
			search: "%_\\",
		});
		const statement = query.toSQL();

		expect(statement.sql.split("ESCAPE '\\'")).toHaveLength(3);
		expect(statement.params).toContain("%\\%\\_\\\\%");
	});

	it("shows submitted titles in the review queue and draft titles elsewhere", async () => {
		const draftRow = {
			creators: [{ creatorType: "author", name: "Later Editor" }],
			date: "2027-01-02",
			key: "AB12CD34",
			title: "QA 2026-09-15: Creator dataset draft (edited after submit)",
			year: 2027,
		} as AdminItemListRow;
		const database = {
			select: () => ({
				from: () => ({
					where: async () => [
						{
							itemKey: "AB12CD34",
							snapshot: {
								records: [
									{
										itemKey: "ZZ99ZZ99",
										payload: { title: "Attachment" },
									},
									{
										itemKey: "AB12CD34",
										payload: {
											creators: [
												{
													creatorType: "author",
													name: "Submitting Creator",
												},
											],
											date: "2026-09-15",
											title: "QA 2026-09-15: Creator dataset draft",
										},
									},
								],
							},
						},
					],
				}),
			}),
		} as unknown as Database;

		expect(await applySubmittedSnapshots(database, true, [draftRow])).toEqual(
			[
				{
					...draftRow,
					creators: [
						{ creatorType: "author", name: "Submitting Creator" },
					],
					date: "2026-09-15",
					title: "QA 2026-09-15: Creator dataset draft",
					year: 2026,
				},
			],
		);
		expect(
			await applySubmittedSnapshots(
				{
					select() {
						throw new Error("the normal list must not read reviews");
					},
				} as unknown as Database,
				false,
				[draftRow],
			),
		).toEqual([draftRow]);
	});

	it("rejects cursor values that do not match the sort column", () => {
		const encoded = Buffer.from(
			JSON.stringify({
				v: 1,
				column: "year",
				direction: "asc",
				key: "AB12CD34",
				nullRank: 0,
				value: "not-a-number",
			}),
		).toString("base64url");

		expect(() => decodeAdminItemCursor(encoded)).toThrow("invalid");
	});
});
