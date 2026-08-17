import { connection, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { getAdminPublicationWorkerOverview } from "@/lib/admin/publication-worker-service";

export async function GET() {
	await connection();
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const config = await getLibraryConfig();
		return NextResponse.json(
			await getAdminPublicationWorkerOverview(
				await getDatabaseForConfig(config),
				config,
			),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
