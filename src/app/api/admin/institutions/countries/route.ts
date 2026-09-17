import { connection, NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/db";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";
import {
	institutionCountryInputSchema,
	institutionCountryNamesSchema,
	institutionCountryRemovalSchema,
	readInstitutionCountries,
	removeInstitutionCountry,
	saveInstitutionCountry,
} from "@/lib/admin/institution-countries";
import { hasMatchingRequestOrigin } from "@/lib/runtime-routing";

export async function GET(request: NextRequest) {
	await connection();
	return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async () =>
		NextResponse.json(
			await readInstitutionCountries(
				await getDatabase(),
				institutionCountryNamesSchema.parse(
					request.nextUrl.searchParams.getAll("name"),
				),
			),
			{ headers: ADMIN_RESPONSE_HEADERS },
		),
	);
}

/** A country belongs to the institution name, so one change covers every record. */
async function change(
	request: NextRequest,
	apply: (body: unknown) => Promise<void>,
) {
	await connection();
	if (!hasMatchingRequestOrigin(request.nextUrl, request.headers))
		return NextResponse.json(
			{ error: "Invalid request origin" },
			{ status: 403, headers: ADMIN_RESPONSE_HEADERS },
		);
	return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async () => {
		await apply(await request.json().catch(() => null));
		return new NextResponse(null, {
			status: 204,
			headers: ADMIN_RESPONSE_HEADERS,
		});
	});
}

export function PUT(request: NextRequest) {
	return change(request, async (body) =>
		saveInstitutionCountry(
			await getDatabase(),
			institutionCountryInputSchema.parse(body),
		),
	);
}

export function DELETE(request: NextRequest) {
	return change(request, async (body) =>
		removeInstitutionCountry(
			await getDatabase(),
			institutionCountryRemovalSchema.parse(body).name,
		),
	);
}
