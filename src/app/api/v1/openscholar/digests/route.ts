import { NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { prepareNotificationEditions } from "@/lib/notifications/editions";

/** OpenScholar checks the owner and organization dev flag before this service call. */
export async function POST(request: Request) {
  const denied = await requireOpenScholarBearer(request);
  if (denied) return denied;
  try {
    const config = await getLibraryConfig();
    const result = await prepareNotificationEditions(
      await getDatabaseForConfig(config),
      config,
      new Date(),
      { manualWeekly: true },
    );
    return NextResponse.json(result, {
      headers: ADMIN_RESPONSE_HEADERS,
      status: result.status === "queued" ? 202 : 200,
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
