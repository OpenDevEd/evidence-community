import type { NextRequest } from "next/server";
import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";

import {
	handleAdminJson,
} from "@/lib/admin/http";
import { retryZenodoPublication } from "@/lib/publication/zenodo-activation-service";
import { runAdminPublicationAction } from "@/lib/publication/admin-publication-action";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		return runAdminPublicationAction(key, retryZenodoPublication);
	});
}
