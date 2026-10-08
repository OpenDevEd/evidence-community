import { connection, NextRequest } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson } from "@/lib/admin/http";
import { getAdminPublicationWorkerOverview } from "@/lib/admin/publication-worker-service";
import type { AdminPublicationRuntimeOverview } from "@/lib/admin/publication-worker-contract";

export async function GET(request: NextRequest) {
	await connection();
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
		const config = await getLibraryConfig();
		return {
			...await getAdminPublicationWorkerOverview(
				await getDatabaseForConfig(config),
				config,
			),
			configuration: {
				libraryId: config.authentication.openScholar.libraryId,
				baseUrl: config.identity.baseUrl,
				crossrefEnvironment: config.services.publication.crossref.environment,
				zenodoEnvironment: config.services.publication.zenodo.environment,
				prefix: config.services.publication.crossref.prefix ?? null,
				namespace: config.services.publication.crossref.suffixNamespace ?? null,
			},
		} satisfies AdminPublicationRuntimeOverview;
	});
}
