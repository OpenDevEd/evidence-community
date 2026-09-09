import type { NextRequest } from "next/server";
import { ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";
import { z } from "zod";

import { ZENODO_IDENTIFIER_POLICIES } from "@/db/schema/publication";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import {
	handleAdminJson,
	readOptionalAdminJson,
} from "@/lib/admin/http";
import { activateZenodoPublication } from "@/lib/publication/zenodo-activation-service";
import { buildAdminPublicationView } from "@/lib/publication/admin-publication-view-service";

const requestSchema = z.strictObject({
	identifierPolicy: z.enum(ZENODO_IDENTIFIER_POLICIES).optional(),
});

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
		const { key } = await params;
		const body = requestSchema.parse(await readOptionalAdminJson(request));
		const config = await getLibraryConfig();
		const database = await getDatabaseForConfig(config);
		const activation = await activateZenodoPublication(
			database,
			key,
			config,
			body.identifierPolicy,
		);
		return {
			activation,
			publication: await buildAdminPublicationView(key),
		};
	});
}
