import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import {
	dismissAdminSourceIssues,
	getAdminSourceIssueTypes,
	restoreAdminSourceIssues,
	SOURCE_ISSUE_TYPE_KEYS,
} from "@/lib/admin/source-issues";

type Context = { params: Promise<{ key: string }> };

/** The source's open record issues, counted by type. */
export async function GET(request: NextRequest, { params }: Context) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	const { key } = await params;
	return getAdminSourceIssueTypes(await getDatabase(), key).then(
		(types) => NextResponse.json({ types }, { headers: ADMIN_RESPONSE_HEADERS }),
		adminErrorResponse,
	);
}

const bodySchema = z.union([
	z.object({ action: z.literal("dismiss"), record: z.string().min(1).max(512) }),
	z.object({ action: z.literal("dismiss"), type: z.enum(SOURCE_ISSUE_TYPE_KEYS) }),
	z.object({ action: z.literal("restore"), batch: z.iso.datetime() }),
]);

/** Dismisses one record's issue or a whole type, or undoes a dismissal, without touching the records. */
export async function PATCH(request: NextRequest, { params }: Context) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	try {
		const { key } = await params;
		const body = bodySchema.parse(await readAdminJson(request));
		const database = await getDatabase();
		return NextResponse.json(
			body.action === "restore"
				? await restoreAdminSourceIssues(database, key, body.batch)
				: await dismissAdminSourceIssues(database, key, body),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
