import { and, isNotNull, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { chunkValues } from "@/lib/chunk-values";

import { OPENALEX_MAX_IDS_PER_FILTER, type OpenAlexClient } from "./client";

/**
 * Looks up where OpenAlex places each institution the library knows by OpenAlex id but has no location for: after a
 * library's first import that is all of them, after a nightly one the few it met for the first time. Search documents
 * carry no location, so no record is searched again.
 * ponytail: an institution OpenAlex places nowhere is asked about again on every run; none of 1,000 sampled from the
 * Wealth Inequality library lacked a place. Mark such rows if that changes.
 */
export async function locateInstitutions(
	database: Database,
	locate: OpenAlexClient["institutionLocations"],
	heartbeat: () => Promise<void>,
) {
	const rows = await database
		.selectDistinct({ id: institutionCountry.openalexId })
		.from(institutionCountry)
		.where(and(isNotNull(institutionCountry.openalexId), isNull(institutionCountry.latitude)));
	let located = 0;
	for (const ids of chunkValues(rows.map((row) => row.id!), OPENALEX_MAX_IDS_PER_FILTER)) {
		const places = await locate(ids);
		if (places.size) {
			const values = [...places].map(([id, place]) => sql`(${id}, ${place.latitude}::double precision, ${place.longitude}::double precision)`);
			const updated = await database.execute(sql`
				UPDATE ${institutionCountry} SET "latitude" = place.latitude, "longitude" = place.longitude, "updatedAt" = now()
				FROM (VALUES ${sql.join(values, sql`, `)}) AS place(id, latitude, longitude)
				WHERE ${institutionCountry.openalexId} = place.id AND ${institutionCountry.latitude} IS NULL`);
			located += updated.rowCount ?? 0;
		}
		await heartbeat();
	}
	return { unlocated: rows.length, located };
}
