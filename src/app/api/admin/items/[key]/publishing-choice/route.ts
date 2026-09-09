import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { itemPublishingChoice } from "@/db/schema/review";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson, readAdminJson } from "@/lib/admin/http";
import { setItemPublishingChoice } from "@/lib/admin/review-service";

type Context = { params: Promise<{ key: string }> };
export function GET(request: NextRequest, { params }: Context) {
  return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
    const [{key}, db] = await Promise.all([params, getDatabase()]);
    const [stored] = await db.select().from(itemPublishingChoice).where(eq(itemPublishingChoice.itemKey, key));
    return {choice: stored?.choice ?? null};
  });
}
export function PUT(request: NextRequest, { params }: Context) {
  return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
    const [{key}, db, body] = await Promise.all([params, getDatabase(), readAdminJson(request)]);
    return {choice: await setItemPublishingChoice(db, key, body)};
  });
}
