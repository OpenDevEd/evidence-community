import type { NextRequest } from "next/server";
import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import { handleAdminJson } from "@/lib/admin/http";
import { retryCrossrefPublication } from "@/lib/publication/crossref-activation-service";
import { buildAdminPublicationView } from "@/lib/publication/admin-publication-view-service";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		const database = await getDatabase();
		const activation = await retryCrossrefPublication(
			database,
			key,
			await getLibraryConfig(),
		);
		return {
			activation,
			publication: await buildAdminPublicationView(key),
		};
	});
}
