import { connection, type NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/admin/http";
import { adminLiveResponse } from "@/lib/admin/live";

/** The admin page's stream of what changed since it was read, for anyone who may open the admin. */
export async function GET(request: NextRequest) {
	await connection();

	const denied = await requireAdminSession(request);
	if (denied) return denied;

	return adminLiveResponse(request.signal);
}
