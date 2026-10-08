import { NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { z } from "zod";
import { prepareDigestForPeriod, prepareNotificationEditions } from "@/lib/notifications/editions";

const periodSchema = z.object({ start: z.coerce.date(), end: z.coerce.date() }).strict().refine(period => period.start < period.end && period.end <= new Date());

/**
 * OpenScholar checks the owner and organization dev flag before this service call.
 * Without a body it sends the digest that is due now. With a past period it
 * writes or rewrites that period's digest by publication date and emails no one.
 */
export async function POST(request: Request) {
  const config = await getLibraryConfig();
  const denied = await requireOpenScholarBearer(request, config.authentication.openScholar.machineCredential);
  if (denied) return denied;
  const text = await request.text();
  let period: z.infer<typeof periodSchema> | undefined;
  if (text) {
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = null; }
    const parsed = z.object({ period: periodSchema }).strict().safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { headers: ADMIN_RESPONSE_HEADERS, status: 400 });
    period = parsed.data.period;
  }
  try {
    const db = await getDatabaseForConfig(config);
    const result = period
      ? await prepareDigestForPeriod(db, config, period)
      : await prepareNotificationEditions(db, config, new Date(), { manualDigest: true });
    return NextResponse.json(result, {
      headers: ADMIN_RESPONSE_HEADERS,
      status: result.status === "queued" ? 202 : 200,
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
