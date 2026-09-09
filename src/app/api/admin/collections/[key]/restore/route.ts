import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { loadLibraryConfig } from "@/config/library-config/source";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminPublisher,
} from "@/lib/admin/http";
import { toAdminCollection } from "@/lib/admin/library-query-service";
import { restoreAdminCollection } from "@/lib/admin/collection-mutation-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminPublisher(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const result = await restoreAdminCollection(
			await getDatabase(),
			key,
			await readAdminJson(request),
			{ writebackConfig: await loadLibraryConfig() },
		);
		return NextResponse.json(
			{
				collection: toAdminCollection(result.collection),
				collections: result.collections.map(toAdminCollection),
				indexingReceipts: [
					...result.collections.map((collection) =>
						adminSearchIndexReceipt("collection", collection),
					),
					...result.indexingItems.map((item) =>
						adminSearchIndexReceipt("item", item),
					),
				],
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
