import type { NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { itemReview } from "@/db/schema/review";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson } from "@/lib/admin/http";
export async function GET(request: NextRequest) {
 return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
  const [result] = await (await getDatabase()).select({count: count()}).from(itemReview).where(eq(itemReview.state, "pending"));
  return {count: result?.count ?? 0};
 });
}
