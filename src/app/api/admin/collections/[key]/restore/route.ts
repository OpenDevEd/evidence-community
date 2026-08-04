import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminBypass,
} from "@/lib/admin/http";
import { toAdminCollection } from "@/lib/admin/library-query-service";
import { restoreNativeCollection } from "@/lib/admin/native-collection-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const result = await restoreNativeCollection(
			await getDatabase(),
			key,
			await readAdminJson(request),
		);
		revalidateTag("collections", "max");
		return NextResponse.json(
			{
				collection: toAdminCollection(result.collection),
				collections: result.collections.map(toAdminCollection),
				indexingReceipts: result.collections.map((collection) =>
					adminSearchIndexReceipt("collection", collection),
				),
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
