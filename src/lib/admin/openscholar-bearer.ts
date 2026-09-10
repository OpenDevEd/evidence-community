import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { ADMIN_RESPONSE_HEADERS } from "./http";

function bearerMatches(authorization: string | null, credential: string) {
	const actual = Buffer.from(authorization ?? "", "utf8");
	const expected = Buffer.from(`Bearer ${credential}`, "utf8");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Lets a request through only when it carries the library's OpenScholar
 * machine credential as a bearer token. Cookies are ignored on purpose: these
 * routes are for OpenScholar, not for a signed-in admin. Pass a credential from
 * an already-loaded config to keep authorization and execution on one revision.
 */
export async function requireOpenScholarBearer(request: Request, machineCredential?: string) {
	const credential = machineCredential ?? (await getLibraryConfig()).authentication.openScholar.machineCredential;
	if (
		bearerMatches(
			request.headers.get("authorization"),
			credential,
		)
	) {
		return null;
	}
	return NextResponse.json(
		{
			error: {
				code: "unauthorized",
				message: "Use the library's machine credential as a bearer token.",
			},
		},
		{ headers: ADMIN_RESPONSE_HEADERS, status: 401 },
	);
}
