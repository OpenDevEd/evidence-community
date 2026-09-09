import type { NextRequest } from "next/server";
import { getDatabase } from "@/db";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson } from "@/lib/admin/http";
import { getItemReviews, submitItemReview } from "@/lib/admin/review-service";

type Context = { params: Promise<{ key: string }> };
export function GET(request: NextRequest, { params }: Context) {
  return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
    const [{key}, db] = await Promise.all([params, getDatabase()]);
    return {reviews: await getItemReviews(db, key)};
  });
}
export function POST(request: NextRequest, { params }: Context) {
  return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async session => {
    const [{key}, db] = await Promise.all([params, getDatabase()]);
    return {review: await submitItemReview(db, key, {userId: session.clerkUserId, role: session.role})};
  });
}
