import { connection, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getDatabase } from "@/db";
import {
	institutionCountryNamesSchema,
	readInstitutionCountries,
} from "@/lib/admin/institution-countries";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

/** Countries of the named institutions, for flags beside authors' affiliations. */
export async function GET(request: NextRequest) {
	// The library's configuration and database exist only at run time.
	await connection();
	try {
		return NextResponse.json(
			await readInstitutionCountries(
				await getDatabase(),
				institutionCountryNamesSchema.parse(
					request.nextUrl.searchParams.getAll("name"),
				),
			),
			{ headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL } },
		);
	} catch (error) {
		if (error instanceof ZodError)
			return NextResponse.json(
				{ error: "INVALID_INSTITUTION_NAMES" },
				{ status: 400, headers: { "Cache-Control": "no-store" } },
			);
		throw error;
	}
}
