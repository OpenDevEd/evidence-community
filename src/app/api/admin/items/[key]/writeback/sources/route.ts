import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";
import { type NextRequest } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	handleAdminJson,
	readAdminJson,
} from "@/lib/admin/http";
import { setAdminItemWritebackSources } from "@/lib/admin/source-writeback-service";
import { adminWritebackSourcesRequestSchema } from "@/lib/admin/writeback-request-contract";

export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		const { sourceKeys } = adminWritebackSourcesRequestSchema.parse(
			await readAdminJson(request),
		);
		const [database, config] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		return {
			writeback: await setAdminItemWritebackSources(
				database,
				key,
				sourceKeys,
				config,
			),
		};
	});
}
