import "server-only";

import { timingSafeEqual } from "node:crypto";
import { connection, NextResponse } from "next/server";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "./http";

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

/**
 * Answers an OpenScholar request about one of the library's sources. One configuration revision authorises the call,
 * by the machine credential, and holds the request. `run` gives the answer, or the code of a refusal in `refused`.
 */
export async function answerSourceRequest<Code extends string>(
	request: Request,
	params: Promise<{ key: string }>,
	refused: Record<Code, { message: string; status: number }>,
	run: (input: { request: Request; config: LibraryServerConfig; database: Database; key: string }) => Promise<{ body: unknown; status: number } | Code>,
) {
	await connection();
	const config = await getLibraryConfig();
	const denied = await requireOpenScholarBearer(request, config.authentication.openScholar.machineCredential);
	if (denied) return denied;
	try {
		const answer = await run({ request, config, database: await getDatabaseForConfig(config), key: (await params).key });
		if (typeof answer === "object") return NextResponse.json(answer.body, { headers: ADMIN_RESPONSE_HEADERS, status: answer.status });
		const { message, status } = refused[answer];
		return NextResponse.json({ error: { code: answer, message } }, { headers: ADMIN_RESPONSE_HEADERS, status });
	} catch (error) {
		return adminErrorResponse(error);
	}
}
