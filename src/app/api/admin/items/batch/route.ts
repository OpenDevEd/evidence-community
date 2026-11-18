import { removeUnreferencedPrivateFiles } from "@/lib/admin/file-retention";
import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminPublisher,
	requireAdminSession,
} from "@/lib/admin/http";
import { adminItemBatchRequestSchema } from "@/lib/admin/item-batch-contract";
import { runAdminItemBatch } from "@/lib/admin/item-batch-service";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { hideRemovedFiles } from "@/lib/admin/withdrawn-files";

export async function POST(request: NextRequest) {
 const unauthorized = await requireAdminSession(request);
 if (unauthorized) return unauthorized;
	try {
		const input = adminItemBatchRequestSchema.parse(
			await readAdminJson(request),
		);
        const denied = input.action === "remove" ? await requireAdminPublisher(request) : null;
        if (denied) return denied;
		const [runtime, writebackConfig] = await Promise.all([
			getNativeFileRuntime(),
			getLibraryConfig(),
		]);
		const execution = await runAdminItemBatch(input, {
			db: runtime.db,
			removePrivateFiles: (paths) => removeUnreferencedPrivateFiles(runtime.db, runtime.storage, paths),
			hideRemovedFiles: (parentKey) => hideRemovedFiles(runtime.db, runtime.storage, parentKey),
			writebackPolicyOptions: { writebackConfig },
		});
		return NextResponse.json(
			{ results: execution.results },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
