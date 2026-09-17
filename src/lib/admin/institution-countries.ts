import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { institutionNameKey } from "@/config/library-config/institutions";
import type { Database } from "@/db/database-schema";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { countryFocusNames } from "@/lib/country-focus";

import type { OpenScholarInstitutionPage } from "./openscholar-institutions";

const OPENALEX = "https://api.openalex.org";
const OPENALEX_RESULTS = 8;

export type InstitutionCountry = {
	countryCode: string;
	openalexId: string | null;
	city: string | null;
};
/** Keyed by `institutionNameKey`. A name with no known country is absent. */
export type InstitutionCountries = Record<string, InstitutionCountry>;

export type AdminInstitutionPage = {
	items: (OpenScholarInstitutionPage["items"][number] & {
		countryCode?: string;
		openalexId?: string | null;
	})[];
	nextCursor: string | null;
};

export type OpenAlexInstitution = {
	id: string;
	name: string;
	countryCode: string;
	city: string;
};

const nameSchema = z.string().trim().min(1).max(500);
const countryCodeSchema = z
	.string()
	.refine((code) => code in countryFocusNames, "Choose a valid country.");

export const institutionCountryNamesSchema = z.array(nameSchema).max(200);
export const institutionCountryRemovalSchema = z
	.object({ name: nameSchema })
	.strict();
export const institutionCountryInputSchema = z
	.object({
		name: nameSchema,
		countryCode: countryCodeSchema,
		openalexId: z
			.string()
			.regex(/^I\d+$/)
			.nullable()
			.default(null),
		city: z.string().trim().max(200).nullable().default(null),
	})
	.strict();
export const openAlexInstitutionQuerySchema = z.string().trim().min(3).max(200);

export async function readInstitutionCountries(
	database: Database,
	names: readonly string[],
): Promise<InstitutionCountries> {
	const keys = [...new Set(names.map(institutionNameKey))].filter(Boolean);
	if (keys.length === 0) return {};
	const rows = await database
		.select()
		.from(institutionCountry)
		.where(inArray(institutionCountry.nameKey, keys));
	return Object.fromEntries(
		rows.map(({ nameKey, countryCode, openalexId, city }) => [
			nameKey,
			{ countryCode, openalexId, city },
		]),
	);
}

export async function withInstitutionCountries(
	database: Database,
	page: OpenScholarInstitutionPage,
): Promise<AdminInstitutionPage> {
	const countries = await readInstitutionCountries(
		database,
		page.items.map((item) => item.name),
	);
	return {
		...page,
		items: page.items.map((item) => {
			const country = countries[institutionNameKey(item.name)];
			return country
				? {
						...item,
						countryCode: country.countryCode,
						openalexId: country.openalexId,
					}
				: item;
		}),
	};
}

export async function saveInstitutionCountry(
	database: Database,
	input: z.infer<typeof institutionCountryInputSchema>,
) {
	const { name, ...country } = input;
	const row = { ...country, updatedAt: new Date() };
	await database
		.insert(institutionCountry)
		.values({ nameKey: institutionNameKey(name), ...row })
		.onConflictDoUpdate({ target: institutionCountry.nameKey, set: row });
}

export async function removeInstitutionCountry(
	database: Database,
	name: string,
) {
	await database
		.delete(institutionCountry)
		.where(eq(institutionCountry.nameKey, institutionNameKey(name)));
}

async function openAlexJson(path: string, signal?: AbortSignal) {
	const response = await fetch(`${OPENALEX}${path}`, {
		signal: AbortSignal.any([
			AbortSignal.timeout(8_000),
			...(signal ? [signal] : []),
		]),
	});
	if (!response.ok)
		throw new Error(
			`OpenAlex returned ${response.status} for ${path}: ${(await response.text()).slice(0, 300)}`,
		);
	return response.json() as Promise<unknown>;
}

const openAlexId = (url: string) => url.split("/").pop() ?? "";

/**
 * Autocomplete matches half-typed words ("harv") but carries no country code,
 * so a second request reads the matched records.
 */
export async function searchOpenAlexInstitutions(
	query: string,
	signal?: AbortSignal,
): Promise<OpenAlexInstitution[]> {
	const suggested = z
		.object({ results: z.array(z.object({ id: z.string() })) })
		.parse(
			await openAlexJson(
				`/autocomplete/institutions?q=${encodeURIComponent(query)}`,
				signal,
			),
		);
	// Anything that is not an institution id would break the filter below.
	const ids = suggested.results
		.map((row) => openAlexId(row.id))
		.filter((id) => /^I\d+$/.test(id))
		.slice(0, OPENALEX_RESULTS);
	if (ids.length === 0) return [];
	const records = z
		.object({
			results: z.array(
				z.object({
					id: z.string(),
					display_name: z.string(),
					country_code: z.string().nullable(),
					geo: z.object({ city: z.string().nullable() }).nullable(),
				}),
			),
		})
		.parse(
			await openAlexJson(
				`/institutions?filter=openalex:${ids.join("|")}&per-page=${ids.length}&select=id,display_name,country_code,geo`,
				signal,
			),
		);
	return records.results
		.map((row) => ({
			id: openAlexId(row.id),
			name: row.display_name,
			// A country OpenAlex knows but this library cannot show is no country.
			countryCode:
				row.country_code && row.country_code in countryFocusNames
					? row.country_code
					: "",
			city: row.geo?.city ?? "",
		}))
		.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
}
