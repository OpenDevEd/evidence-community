import { and, eq, inArray, or, sql } from "drizzle-orm";
import { chunkValues } from "@/lib/chunk-values";
import { z } from "zod";

import { institutionNameKey } from "@/config/library-config/institutions";
import type { Database } from "@/db/database-schema";
import type { DatabaseTransaction } from "@/db/cancellable-transaction";
import { item } from "@/db/schema/tables/item";
import { itemInstitution } from "@/db/schema/tables/itemInstitution";
import { enqueueItemSearchReprojections } from "@/lib/publication/queue";
import { institutionKeySql } from "@/lib/institution-country-sql";
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
	const nameKey = institutionNameKey(name);
	await database.transaction(async (transaction) => {
		await transaction
			.insert(institutionCountry)
			.values({ nameKey, ...row })
			.onConflictDoUpdate({ target: institutionCountry.nameKey, set: row });
		await reindexAuthorsAt(transaction, [name]);
	});
}

export async function removeInstitutionCountry(
	database: Database,
	name: string,
) {
	const nameKey = institutionNameKey(name);
	await database.transaction(async (transaction) => {
		await transaction
			.delete(institutionCountry)
			.where(eq(institutionCountry.nameKey, nameKey));
		await reindexAuthorsAt(transaction, [name]);
	});
}

/**
 * Search counts and filters records by their authors' affiliation countries, so every record with an author at these
 * institutions is searched again with its new country, in the same transaction as the change. Records are found by the
 * name as written and by its SQL fold, then kept only where JavaScript folds the name the same way: the two folds differ
 * on a few letters (a dotted capital I), and the search document uses JavaScript's.
 */
export async function reindexAuthorsAt(transaction: DatabaseTransaction, names: readonly string[], { folded = true } = {}) {
	const keys = new Set(names.map(institutionNameKey));
	for (const chunk of chunkValues([...new Set(names)], 500)) {
		const rows = await transaction
			.selectDistinct({ itemKey: item.key, revision: item.revision, institutionName: itemInstitution.institutionName })
			.from(itemInstitution)
			.innerJoin(item, eq(item.key, itemInstitution.itemKey))
			.where(and(
				eq(itemInstitution.source, "author"),
				// The fold can't use the name index, so an import, whose names are spelled as its records spell them, skips it.
				folded
					? or(inArray(itemInstitution.institutionName, chunk), inArray(institutionKeySql(sql`${itemInstitution.institutionName}`), chunk.map(institutionNameKey)))
					: inArray(itemInstitution.institutionName, chunk),
			));
		const records = new Map(rows.filter((row) => keys.has(institutionNameKey(row.institutionName))).map((row) => [row.itemKey, { itemKey: row.itemKey, revision: row.revision }]));
		await enqueueItemSearchReprojections(transaction, [...records.values()], new Date());
	}
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
