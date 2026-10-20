import { isNotNull } from "drizzle-orm";
import { connection, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

/** Every located institution by its folded name: longitude, latitude, city and country, for the map's institutions. */
export async function GET() {
	await connection();
	const rows = await (await getDatabase())
		.select({ key: institutionCountry.nameKey, longitude: institutionCountry.longitude, latitude: institutionCountry.latitude, city: institutionCountry.city, country: institutionCountry.countryCode })
		.from(institutionCountry)
		.where(isNotNull(institutionCountry.latitude));
	return NextResponse.json(Object.fromEntries(rows.map((row) => [row.key, [row.longitude, row.latitude, row.city ?? "", row.country]])), {
		headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
	});
}
