import { COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";
import POPULATION from "@/constants/population.json";

/** What a country's colour and place in the list show: its records for each million people living there, or its records. */
export const MEASURES = ["people", "records"] as const;
export type Measure = (typeof MEASURES)[number];

const PEOPLE = POPULATION as Record<string, number>;

/** A country in the list: its records, and the value it is ranked and coloured by, none where its population is not known. */
export type CountryRow = { code: string; name: string; count: number; value: number | null };

/** Records for each million people, from the World Bank's 2025 population (SP.POP.TOTL). */
const perMillion = (code: string, count: number) => (PEOPLE[code] ? (count / PEOPLE[code]) * 1e6 : null);

/** A country's value in a measure: its records for each million people (none where its population is not known), or its records. */
export const measureOf = (code: string, count: number, measure: Measure) => (measure === "people" ? perMillion(code, count) : count);

/** Records for each million people for a country with records whose population is known; otherwise none. */
export const perPerson = (code: string | undefined, count: number) => (code && count ? perMillion(code, count) : null);

/** Only countries the region filter knows can be chosen, so only they are listed: largest first, those without a value last. */
export function countryRows(facet: Record<string, number>, measure: Measure): CountryRow[] {
	return Object.entries(facet)
		.flatMap(([code, count]) => (COUNTRY_PARAMS[code] && count ? [{ code, name: COUNTRIES[code] ?? code, count: Number(count), value: measureOf(code, Number(count), measure) }] : []))
		.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

/** The value that takes the full colour. Per person, a few small states (Monaco: 16 records, 38,000 people) sit far above the rest,
 * so the top 5% share the full colour and the others spread over the whole ramp. Records keep the busiest country as the top. */
export function scaleTop(rows: { value: number | null }[], measure: Measure) {
	const values = rows.flatMap((row) => (row.value ? [row.value] : []));
	if (!values.length) return 1;
	return measure === "people" ? values[Math.floor(values.length * 0.05)] : values[0];
}
