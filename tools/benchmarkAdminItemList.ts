import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import type { Database } from "../src/db/database-schema";
import type { AdminItemSortColumnId } from "../src/lib/admin/item-list-contract";
import {
	buildAdminItemListQuery,
	encodeAdminItemCursor,
} from "../src/lib/admin/item-list-query";
import { createAdminItemListFixture } from "./adminItemListFixture";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");

const rowCount = Number(process.argv[2] ?? 100_000);
if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 1_000_000) {
	throw new Error("Row count must be an integer between 1 and 1,000,000");
}

type PlanNode = {
	"Actual Rows"?: number;
	"Index Name"?: string;
	"Node Type": string;
	Plans?: PlanNode[];
};

type ExplainPlan = {
	"Execution Time": number;
	"Planning Time": number;
	Plan: PlanNode;
};

function planNodes(node: PlanNode): PlanNode[] {
	return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

async function explain(
	client: Client,
	database: Database,
	input: Parameters<typeof buildAdminItemListQuery>[1],
	{
		requireSortIndex = true,
	}: {
		requireSortIndex?: boolean;
	} = {},
) {
	const statement = buildAdminItemListQuery(database, input).query.toSQL();
	const result = await client.query<{ "QUERY PLAN": ExplainPlan[] }>(
		`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
		statement.params,
	);
	const plan = result.rows[0]!["QUERY PLAN"][0]!;
	const nodes = planNodes(plan.Plan);
	const indexes = nodes
		.map((node) => node["Index Name"])
		.filter((name): name is string => Boolean(name));
	if (
		requireSortIndex &&
		(!nodes.some((node) =>
			["Index Only Scan", "Index Scan"].includes(node["Node Type"]),
		) ||
			nodes.some((node) =>
				["Incremental Sort", "Sort"].includes(node["Node Type"]),
			))
	) {
		throw new Error(
			`Admin list query did not use a sort index: ${JSON.stringify(nodes.map((node) => node["Node Type"]))}`,
		);
	}
	return {
		executionMs: plan["Execution Time"],
		indexes,
		planningMs: plan["Planning Time"],
		planNodes: nodes.map((node) => node["Node Type"]),
	};
}

function cursorFor(
	column: AdminItemSortColumnId,
	direction: "asc" | "desc",
	position: number,
) {
	const value = (() => {
		switch (column) {
			case "title":
				return `teacher evidence record ${String(position).padStart(7, "0")}`;
			case "year":
				return 2000 + (position % 26);
			case "updated":
				return new Date(
					Date.parse("2026-07-31T00:00:00.000Z") -
						Math.floor(position / 25) * 1_000,
				).toISOString();
			case "itemType":
				return ["Book", "Document", "JournalArticle", "Report"][
					position % 4
				]!;
			case "pageCount":
				return position % 4 === 0 ? null : 1 + (position % 800);
		}
	})();
	return encodeAdminItemCursor({
		column,
		direction,
		key: `b${position.toString(16).padStart(7, "0")}`,
		nullRank: value === null ? 1 : 0,
		value,
	});
}

async function benchmark() {
	const client = new Client({ connectionString: databaseUrl });
	await client.connect();
	const database = drizzle(client) as unknown as Database;
	try {
		await client.query("BEGIN");
		await createAdminItemListFixture(client, rowCount);

		const middle = Math.floor(rowCount / 2);
		const sorts = [
			"title",
			"year",
			"updated",
			"itemType",
			"pageCount",
		] as const;
		const results: Record<string, unknown> = {};
		for (const column of sorts) {
			for (const direction of ["asc", "desc"] as const) {
				results[`${column}:${direction}:first`] = await explain(
					client,
					database,
					{ sorting: [{ column, direction }] },
				);
				results[`${column}:${direction}:cursor`] = await explain(
					client,
					database,
					{
						cursor: cursorFor(column, direction, middle),
						sorting: [{ column, direction }],
					},
				);
			}
		}
		results.search = await explain(
			client,
			database,
			{ search: `record ${Math.floor(rowCount / 3)}` },
			{ requireSortIndex: false },
		);
		console.log(JSON.stringify({ rowCount, results }, null, 2));
		await client.query("ROLLBACK");
	} finally {
		await client.end();
	}
}

benchmark().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
