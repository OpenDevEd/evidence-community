import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import { revalidatePublishedItemCaches } from "@/lib/admin/cache";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { publishItemDraftWithContext } from "@/lib/admin/native-item-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

export async function POST(
	_request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const [db, writebackConfig] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		const { indexingRecords, item, previousParentItem } =
			await publishItemDraftWithContext(db, key, { writebackConfig });
		revalidatePublishedItemCaches(
			item.key,
			item.parentItem,
			previousParentItem,
		);
		return NextResponse.json(
			{
				indexingReceipts: indexingRecords.map((record) =>
					adminSearchIndexReceipt("item", record),
				),
				item,
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
