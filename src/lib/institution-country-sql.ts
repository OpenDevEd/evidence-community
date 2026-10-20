import { sql, type SQL } from "drizzle-orm";

import { institutionCountry } from "@/db/schema/tables/institutionCountry";

/**
 * The SQL twin of `institutionNameKey`.
 * ponytail: PostgreSQL and JavaScript fold a few rare letters differently (a
 * dotted capital I, for one), so such a name finds no country here. Store the
 * key beside each affiliation if that ever matters.
 */
export function institutionKeySql(name: SQL) {
	return sql`lower(btrim(normalize(${name}, NFC)))`;
}

/** Joins the library's country for the institution named by `name`. */
export function institutionCountryJoin(name: SQL) {
	return sql`LEFT JOIN ${institutionCountry} ON ${institutionCountry.nameKey} = ${institutionKeySql(name)}`;
}

/** Null when the institution has no known country. */
export const institutionCountryCode = sql`${institutionCountry.countryCode}`;

/** For a row of `jsonb_array_elements(creator_data->'institutions') as institution_data`. */
export const affiliationCountryJoin = institutionCountryJoin(
	sql`institution_data->>'display_name'`,
);
