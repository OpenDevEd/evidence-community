import { readAdminSourceKey } from "@/lib/admin/writeback-request-contract";
import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";
import { type NextRequest } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import { handleAdminJson } from "@/lib/admin/http";
import { retryAdminSourceWriteback } from "@/lib/admin/source-writeback-service";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		const sourceKey = readAdminSourceKey(request.nextUrl.searchParams);
		const [database, config] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		return {
			status: await retryAdminSourceWriteback(
				database,
				key,
				sourceKey,
				config,
			),
		};
	});
}
