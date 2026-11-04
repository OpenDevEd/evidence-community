import type { HomeData } from "./HomePage";
import { serializeSearchParams } from "@/lib/searchParams";

// The explorer's rows that open a filtered listing. The page builds them in the browser and the server builds the same
// ones to send each view's first publications with the page, so both must agree on every row's filter.

/** A row of the explorer. `filter` is the listing's query for its publications, where the listing can filter by it. */
export type Row = { name: string; count: number; filter?: string; flag?: string };

/** The library's switches that decide which rows can open a filtered listing. */
type Listing = { filters: { years: { enabled: boolean }; institution: { mode: string } }; search: { country: boolean } };

type Figures = Pick<HomeData, "years" | "countries" | "countryPaths" | "collections" | "topics" | "institutions">;

/** Years as a continuous series, so a year without publications still has its place on the axis. */
/** At most a century, ending no later than next year: stray dates such as 9999 would otherwise stretch the chart over thousands of empty years. */
function yearSeries(data: Pick<HomeData, "years">, thisYear: number) {
	const counts = new Map(data.years.filter((row) => row.year <= thisYear + 1).map((row) => [row.year, row.count]));
	if (!counts.size) return [];
	const lastYear = Math.max(...counts.keys());
	const firstYear = Math.max(Math.min(...counts.keys()), lastYear - 99);
	return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => ({ label: String(firstYear + index), value: counts.get(firstYear + index) ?? 0 }));
}

/** The rows of every view that can open a filtered listing; years run newest first and open on the busiest one. */
export function listedRows(data: Figures, { filters, search }: Listing, today: string, countryName: (code: string) => string = (code) => code) {
	/** The listing's query for one of its filters, or nothing where the library has that filter switched off. */
	const listing = (on: boolean, params: { collections?: string[]; country?: string[]; institution?: string[]; range?: string; topics?: string[] }) => (on ? serializeSearchParams(params).slice(1) : undefined);
	const series = yearSeries(data, Number(today.slice(0, 4)));
	const peak = series.reduce((best, point, index) => (point.value > (series[best]?.value ?? -1) ? index : best), 0);
	return {
		series,
		/** The busiest year's place in the newest-first list. */
		busiest: series.length - 1 - peak,
		years: series.map((point): Row => ({ name: point.label, count: point.value, filter: listing(filters.years.enabled, { range: point.label }) })).reverse(),
		countries: Object.entries(data.countries).sort((a, b) => b[1] - a[1]).map(([code, count]): Row => ({ name: countryName(code), count, flag: code, filter: listing(search.country && Boolean(data.countryPaths[code]), { country: [data.countryPaths[code]!] }) })),
		collections: data.collections.map((collection): Row => ({ name: collection.title, count: collection.count, filter: listing(true, { collections: [collection.key] }) })),
		topics: data.topics.map((row): Row => ({ ...row, filter: listing(true, { topics: [row.key] }) })),
		institutions: data.institutions.map((row): Row => ({ ...row, filter: listing(filters.institution.mode !== "hidden", { institution: [row.name] }) })),
	};
}

/** The filter of the row each view opens on, for the views that have one. */
export function firstFilters(rows: ReturnType<typeof listedRows>) {
	return [...new Set([rows.years[rows.busiest], rows.countries[0], rows.collections[0], rows.topics[0], rows.institutions[0]].flatMap((row) => (row?.filter && row.count > 0 ? [row.filter] : [])))];
}

/** Where the explorer asks for a row's two newest publications; the server sends its answers under the same address. */
export const examplesKey = (filter: string) => `/items?${filter}&sort=desc&perPage=2`;
