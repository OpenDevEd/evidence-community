import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { setAdminSourceIssueDismissed } from "@/lib/admin/library-query-service";

type Context = { params: Promise<{ key: string; recordKey: string }> };

const bodySchema = z.object({ dismissed: z.boolean() });

/** Dismisses an import issue, or opens it again, without touching the record. */
export async function PATCH(request: NextRequest, { params }: Context) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	try {
		const { key, recordKey } = await params;
		const body = bodySchema.parse(await readAdminJson(request));
		return NextResponse.json(
			await setAdminSourceIssueDismissed(
				await getDatabase(),
				key,
				recordKey,
				body.dismissed,
			),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
