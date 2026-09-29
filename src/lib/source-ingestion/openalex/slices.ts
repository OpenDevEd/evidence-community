import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import type { OpenAlexClient } from "./client";
import type { OpenAlexQuery } from "./schema";

/**
 * Publication dates from `from` up to, not including, `to`. Null is the
 * works with no publication date.
 */
export type SliceDates = { from: string | null; to: string | null } | null;

/** Below this, one stream of pages is quick enough. */
export const MIN_SLICED_WORKS = 20_000;
const TARGET_SLICES = 16;
const PLANNING_CONCURRENCY = 12;

function dayBefore(date: string) {
	return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export function slicedQuery(query: OpenAlexQuery, dates: SliceDates): OpenAlexQuery {
	if (query.oql) {
		const where = query.oql.replace(/^works\s+where\s+/i, "");
		const clause = dates
			? [dates.from && `publication_date >= ${dates.from}`, dates.to && `publication_date < ${dates.to}`]
					.filter(Boolean)
					.join(" and ")
			: "publication_date is null";
		return { oql: `works where (${where}) and ${clause}` };
	}
	const clauses = dates
		? [dates.from && `from_publication_date:${dates.from}`, dates.to && `to_publication_date:${dayBefore(dates.to)}`]
		: ["publication_date:null"];
	return {
		...query,
		filter: [query.filter, ...clauses].filter(Boolean).join(","),
	};
}

const countOf = async (client: OpenAlexClient, query: OpenAlexQuery) => (await client.works(query, "*", 1)).meta.count;

/** A year, or its twelve months when the year alone is bigger than a slice. */
function yearPieces(year: number, count: number, target: number) {
	if (count <= target) return [{ from: `${year}-01-01`, to: `${year + 1}-01-01`, count: count as number | null }];
	return Array.from({ length: 12 }, (_, month) => ({
		from: `${year}-${String(month + 1).padStart(2, "0")}-01`,
		to: month === 11 ? `${year + 1}-01-01` : `${year}-${String(month + 2).padStart(2, "0")}-01`,
		count: null as number | null,
	}));
}

/**
 * Splits a large query into about 16 date ranges of similar size, plus the
 * works with no date, so their pages can be fetched at the same time. Returns
 * null when the query is small, or when the ranges' counts do not add up to
 * the query's, so no work can be missed or read twice.
 */
export async function planSlices(
	client: OpenAlexClient,
	query: OpenAlexQuery,
): Promise<{ dates: SliceDates; count: number }[] | null> {
	const years = (await client.yearCounts(query)).sort((a, b) => a.year - b.year);
	const dated = years.reduce((sum, year) => sum + year.count, 0);
	if (dated < MIN_SLICED_WORKS) return null;
	const target = dated / TARGET_SLICES;
	const pieces = years.flatMap(({ year, count }) => yearPieces(year, count, target));
	const uncounted = pieces.filter((piece) => piece.count === null);
	const monthCounts = await mapWithConcurrency(uncounted, PLANNING_CONCURRENCY, (piece) =>
		countOf(client, slicedQuery(query, { from: piece.from, to: piece.to })),
	);
	uncounted.forEach((piece, index) => (piece.count = monthCounts[index]!));
	const bounds: string[] = [];
	let size = 0;
	pieces.forEach((piece, index) => {
		size += piece.count!;
		const next = pieces[index + 1];
		if (next && size + next.count! > target) {
			bounds.push(next.from);
			size = 0;
		}
	});
	if (!bounds.length) return null;
	const slices: SliceDates[] = [
		...[null, ...bounds].map((from, index) => ({ from, to: bounds[index] ?? null })),
		null,
	];
	const [total, ...counts] = await mapWithConcurrency(
		[query, ...slices.map((dates) => slicedQuery(query, dates))],
		PLANNING_CONCURRENCY,
		(sliceQuery) => countOf(client, sliceQuery),
	);
	const covered = counts.reduce((sum, count) => sum + count, 0);
	if (covered !== total) {
		console.warn("OpenAlex date slices do not cover the query; scanning it as one stream", { total, covered });
		return null;
	}
	return slices.map((dates, index) => ({ dates, count: counts[index]! }));
}
