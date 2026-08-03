import { NextRequest, NextResponse } from "next/server";

import { revalidatePublishedItemCaches } from "@/lib/admin/cache";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminBypass,
} from "@/lib/admin/http";
import { adminItemBatchRequestSchema } from "@/lib/admin/item-batch-contract";
import { runAdminItemBatch } from "@/lib/admin/item-batch-service";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";

export async function POST(request: NextRequest) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const input = adminItemBatchRequestSchema.parse(
			await readAdminJson(request),
		);
		const runtime = await getNativeFileRuntime();
		const execution = await runAdminItemBatch(input, {
			db: runtime.db,
			removePrivateFiles: (paths) => runtime.storage.removePrivate(paths),
		});
		for (const target of execution.revalidationTargets) {
			revalidatePublishedItemCaches(
				target.itemKey,
				target.parentItem,
				target.previousParentItem,
			);
		}
		return NextResponse.json(
			{ results: execution.results },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
