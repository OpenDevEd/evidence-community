import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminSession,
} from "@/lib/admin/http";
import {
	getAdminSourceIssuePage,
	SOURCE_ISSUE_TYPE_KEYS,
} from "@/lib/admin/source-issues";

type Context = { params: Promise<{ key: string; type: string }> };

const querySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100),
	offset: z.coerce.number().int().min(0),
	type: z.enum(SOURCE_ISSUE_TYPE_KEYS),
});

/** One page of a source's open issues of one type. */
export async function GET(request: NextRequest, { params }: Context) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	try {
		const { key, type } = await params;
		const search = request.nextUrl.searchParams;
		const query = querySchema.parse({
			limit: search.get("limit"),
			offset: search.get("offset"),
			type,
		});
		return NextResponse.json(
			await getAdminSourceIssuePage(await getDatabase(), key, query.type, query),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
