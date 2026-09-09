import type { NextRequest } from "next/server";
import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";

import { getDatabase } from "@/db";
import { loadLibraryConfig } from "@/config/library-config/source";
import {
	handleAdminJson,
	readAdminJson,
} from "@/lib/admin/http";
import { toAdminCollection } from "@/lib/admin/library-query-service";
import { restoreAdminCollection } from "@/lib/admin/collection-mutation-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		const result = await restoreAdminCollection(
			await getDatabase(),
			key,
			await readAdminJson(request),
			{ writebackConfig: await loadLibraryConfig() },
		);
		return {
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
		};
	});
}
