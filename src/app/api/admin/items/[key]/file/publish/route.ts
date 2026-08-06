import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { revalidatePublishedItemCaches } from "@/lib/admin/cache";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminBypass,
} from "@/lib/admin/http";
import { filePublicationJson } from "@/lib/admin/file-projection";
import { publishNativePdf } from "@/lib/admin/native-file-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

const bodySchema = z
	.object({
		expectedUploadRevision: z.number().int().positive(),
	})
	.strict();

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const [{ key }, body, runtime] = await Promise.all([
			params,
			readAdminJson(request).then((value) => bodySchema.parse(value)),
			getNativeFileRuntime(),
		]);
		const published = await publishNativePdf(runtime.db, runtime.storage, {
			...body,
			itemKey: key,
			publicationTags: runtime.config.content.tags.publish,
		});
		revalidatePublishedItemCaches(
			published.item.key,
			published.item.parentItem,
		);
		return NextResponse.json(
			{
				file: filePublicationJson(published.file),
				indexingReceipts: published.indexingRecords.map((record) =>
					adminSearchIndexReceipt("item", record),
				),
				item: {
					key: published.item.key,
					parentItem: published.item.parentItem,
					revision: published.item.revision,
				},
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
