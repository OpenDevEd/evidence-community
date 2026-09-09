import { readAdminSourceKey } from "@/lib/admin/writeback-request-contract";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { type NextRequest } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import { handleAdminJson } from "@/lib/admin/http";
import { getAdminSourceWritebackStatus } from "@/lib/admin/source-writeback-service";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
		const { key } = await params;
		const sourceKey = readAdminSourceKey(request.nextUrl.searchParams);
		const [database, config] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		return {
			status: await getAdminSourceWritebackStatus(
				database,
				key,
				sourceKey,
				config,
			),
		};
	});
}
