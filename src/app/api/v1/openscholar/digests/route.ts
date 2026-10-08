import { NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { AdminValidationError } from "@/lib/admin/errors";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { z } from "zod";
import { prepareDigestForPeriod, prepareNotificationEditions } from "@/lib/notifications/editions";

const bodySchema = z.object({
  period: z.object({ start: z.coerce.date(), end: z.coerce.date() }).strict().refine(period => period.start < period.end && period.end <= new Date()),
}).strict();

/** The past period a request names, if it has a body. */
async function requestedPeriod(request: Request) {
  const text = await request.text();
  if (!text) return undefined;
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* fails the validation below */ }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw new AdminValidationError("Send a past period whose start is before its end.");
  return parsed.data.period;
}

/** The digest that is due now, or the one for a past period. */
function prepareDigest(db: Database, config: LibraryServerConfig, period?: { start: Date; end: Date }) {
  return period ? prepareDigestForPeriod(db, config, period) : prepareNotificationEditions(db, config, new Date(), { manualDigest: true });
}

/**
 * OpenScholar checks the owner and organization dev flag before this service call.
 * Without a body it sends the digest that is due now. With a past period it
 * writes or rewrites that period's digest by publication date and emails no one.
 */
export async function POST(request: Request) {
  const config = await getLibraryConfig();
  const denied = await requireOpenScholarBearer(request, config.authentication.openScholar.machineCredential);
  if (denied) return denied;
  try {
    const period = await requestedPeriod(request);
    const result = await prepareDigest(await getDatabaseForConfig(config), config, period);
    return NextResponse.json(result, {
      headers: ADMIN_RESPONSE_HEADERS,
      status: result.status === "queued" ? 202 : 200,
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
