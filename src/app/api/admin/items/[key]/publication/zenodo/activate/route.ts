import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readOptionalAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { activateZenodoPublication } from "@/lib/publication/zenodo-activation-service";
import { buildAdminPublicationView } from "@/lib/publication/admin-publication-view-service";

const requestSchema = z
	.object({
		identifierPolicy: z.enum(["reuse-crossref", "mint-zenodo"]).optional(),
	})
	.strict();

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
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
		return NextResponse.json(
			{
				activation,
				publication: await buildAdminPublicationView(key),
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
