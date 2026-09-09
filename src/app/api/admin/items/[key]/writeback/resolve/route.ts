import { readAdminSourceKey } from "@/lib/admin/writeback-request-contract";
import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";
import { type NextRequest } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	handleAdminJson,
	readAdminJson,
} from "@/lib/admin/http";
import { resolveAdminSourceWritebackConflict } from "@/lib/admin/source-writeback-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { adminWritebackResolveRequestSchema } from "@/lib/admin/writeback-request-contract";
import { createSourceWritebackRuntime } from "@/lib/source-writeback/runtime";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		const sourceKey = readAdminSourceKey(request.nextUrl.searchParams);
		const { choice } = adminWritebackResolveRequestSchema.parse(
			await readAdminJson(request),
		);
		const [database, config] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		const { indexingRecords, status } =
			await resolveAdminSourceWritebackConflict(
				database,
				key,
				sourceKey,
				choice,
				config,
				{ ...createSourceWritebackRuntime(config), signal: request.signal },
			);
		return {
			indexingReceipts: indexingRecords.map((record) =>
				adminSearchIndexReceipt("item", record),
			),
			status,
		};
	});
}
