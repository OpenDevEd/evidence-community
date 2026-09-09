import type { NextRequest } from "next/server";
import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import {
	handleAdminJson,
} from "@/lib/admin/http";
import { retryZenodoPublication } from "@/lib/publication/zenodo-activation-service";
import { buildAdminPublicationView } from "@/lib/publication/admin-publication-view-service";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		const config = await getLibraryConfig();
		const database = await getDatabaseForConfig(config);
		const activation = await retryZenodoPublication(database, key, config);
		return {
			activation,
			publication: await buildAdminPublicationView(key),
		};
	});
}
