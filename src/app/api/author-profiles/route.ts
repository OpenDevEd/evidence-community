import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forwardAuthorProfileRequest } from "@/lib/authors/catalog-server";

const idsSchema = z.array(z.string().regex(/^[a-z0-9]{1,128}$/)).min(1).max(100);

export async function GET(request: NextRequest) {
  const ids = idsSchema.safeParse(request.nextUrl.searchParams.getAll("id"));
  if (!ids.success) return NextResponse.json({error: "Invalid author profile IDs"}, {status: 400, headers: {"Cache-Control": "no-store"}});
  return forwardAuthorProfileRequest({operation: "resolve", profileIds: ids.data});
}
