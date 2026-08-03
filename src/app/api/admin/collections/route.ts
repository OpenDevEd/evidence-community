import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminBypass,
} from "@/lib/admin/http";
import { toAdminCollection } from "@/lib/admin/library-query-service";
import { createNativeCollection } from "@/lib/admin/native-collection-service";

export async function POST(request: NextRequest) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const collection = await createNativeCollection(
			await getDatabase(),
			await readAdminJson(request),
		);
		revalidateTag("collections", "max");
		return NextResponse.json(
			{ collection: toAdminCollection(collection) },
			{ status: 201, headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
