import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { connection, NextResponse } from "next/server";

import { INSTITUTION_FILTER_FIELD, institutionNameKey } from "@/config/library-config/institutions";
import { everyRecordScope } from "@/config/library-config/search";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import type { Database } from "@/db/database-schema";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { itemInstitution } from "@/db/schema/tables/itemInstitution";
import { chunkValues } from "@/lib/chunk-values";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getPublicFacets } from "@/lib/search";
import { isIndexOnly } from "@/lib/search-index/index-only";

type Location = [longitude: number, latitude: number, city: string, country: string];

/** The institutions the public search counts in the whole library, folded: nothing from a draft or a hidden record. */
async function publicInstitutions() {
	const { search } = await getLibraryConfig();
	const facets = await getPublicFacets({ scope: everyRecordScope(search) ?? "" });
	return new Set(Object.keys(facets.facetDistribution?.[INSTITUTION_FILTER_FIELD] ?? {}).map(institutionNameKey));
}

/** The institutions some author works at, folded, however each record spells them: an institution only a record names (a
 * report's publisher) is no author's. */
async function authorInstitutions(database: Database) {
	const rows = await database.selectDistinct({ name: itemInstitution.institutionName }).from(itemInstitution).where(eq(itemInstitution.source, "author"));
	return new Set(rows.map((row) => institutionNameKey(row.name)));
}

/** Where each of these institutions is, for those OpenAlex placed. */
async function locationsOf(database: Database, keys: string[]): Promise<[string, Location][]> {
	const rows = await database
		.select({ key: institutionCountry.nameKey, longitude: institutionCountry.longitude, latitude: institutionCountry.latitude, city: institutionCountry.city, country: institutionCountry.countryCode })
		.from(institutionCountry)
		.where(and(inArray(institutionCountry.nameKey, keys), isNotNull(institutionCountry.latitude)));
	return rows.map((row) => [row.key, [row.longitude!, row.latitude!, row.city ?? "", row.country]]);
}

/**
 * Where the library's public author institutions are, by folded name, for the map's institutions.
 * ponytail: the public search gives at most 10,000 institutions (`maxValuesPerFacet`), so a library with more leaves its
 * least-cited ones unplaced; raise the index's limit if that matters.
 */
export async function GET() {
	await connection();
	const database = await getDatabase();
	// An index-only library's institutions all come from its authors, and it has no records in the database to ask.
	const authorsOnly = !isIndexOnly(await getLibraryConfig());
	const [publicKeys, authorKeys] = await Promise.all([publicInstitutions(), authorsOnly ? authorInstitutions(database) : null]);
	const located: [string, Location][] = [];
	for (const keys of chunkValues([...publicKeys].filter((key) => authorKeys?.has(key) ?? true), 1_000)) located.push(...(await locationsOf(database, keys)));
	return NextResponse.json(Object.fromEntries(located), { headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL } });
}
