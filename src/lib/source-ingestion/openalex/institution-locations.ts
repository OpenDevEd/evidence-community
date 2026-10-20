import { and, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { chunkValues } from "@/lib/chunk-values";

import { OPENALEX_MAX_IDS_PER_FILTER, type OpenAlexClient } from "./client";

/**
 * Looks up where OpenAlex places each institution the library knows by OpenAlex id but has no location or city for: after a
 * library's first import that is all of them, after a nightly one the few it met for the first time. A city an editor set
 * stays. Search documents carry neither, so no record is searched again.
 * ponytail: an institution OpenAlex places nowhere, or in no city, is asked about again on every run; none of 1,000 sampled
 * from the Wealth Inequality library lacked a place. Mark such rows if that changes.
 */
export async function locateInstitutions(
	database: Database,
	locate: OpenAlexClient["institutionLocations"],
	heartbeat: () => Promise<void>,
) {
	const rows = await database
		.selectDistinct({ id: institutionCountry.openalexId })
		.from(institutionCountry)
		.where(and(isNotNull(institutionCountry.openalexId), or(isNull(institutionCountry.latitude), isNull(institutionCountry.city))));
	let located = 0;
	for (const ids of chunkValues(rows.map((row) => row.id!), OPENALEX_MAX_IDS_PER_FILTER)) {
		const places = await locate(ids);
		if (places.size) {
			const values = [...places].map(([id, place]) => sql`(${id}, ${place.latitude}::double precision, ${place.longitude}::double precision, ${place.city}::text)`);
			const updated = await database.execute(sql`
				UPDATE ${institutionCountry} SET "latitude" = place.latitude, "longitude" = place.longitude,
					"city" = coalesce(${institutionCountry.city}, place.city), "updatedAt" = now()
				FROM (VALUES ${sql.join(values, sql`, `)}) AS place(id, latitude, longitude, city)
				WHERE ${institutionCountry.openalexId} = place.id AND (${institutionCountry.latitude} IS NULL OR ${institutionCountry.city} IS NULL)`);
			located += updated.rowCount ?? 0;
		}
		await heartbeat();
	}
	return { unlocated: rows.length, located };
}
