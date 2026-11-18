import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";
import { type NextRequest } from "next/server";

import { getDatabase } from "@/db";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { hideRemovedFiles } from "@/lib/admin/withdrawn-files";
import {
	handleAdminJson,
	readOptionalAdminJson,
} from "@/lib/admin/http";
import { unpublishNativeItemWithOutcome } from "@/lib/admin/native-item-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { adminUnpublishRequestSchema } from "@/lib/admin/writeback-request-contract";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		const { removeFromSourceKeys, withdrawal } = adminUnpublishRequestSchema.parse(
			await readOptionalAdminJson(request),
		);
		const result = await unpublishNativeItemWithOutcome(
			await getDatabase(),
			key,
			{ removeFromSourceKeys, withdrawal },
		);
		// A removed record's attachments that left with it take their public files out of view, here and on any retry.
		if (result.item.deleted === 1) {
			const runtime = await getNativeFileRuntime();
			await hideRemovedFiles(runtime.db, runtime.storage, key);
		}
		const { item } = result;
		return {
			indexingReceipts: result.changed
				? result.indexingRecords.map((record) =>
						adminSearchIndexReceipt("item", record),
					)
				: [],
			item,
		};
	});
}
