import type { NextRequest } from "next/server";
import { z } from "zod";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson } from "@/lib/admin/http";
import { listAdminDigests } from "@/lib/notifications/editorial";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  show: z.enum(["all", "draft", "review", "published"]).default("all"),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

/** A page of the library's digests with where each stands. */
export function GET(request: NextRequest) {
  return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
    const config = await getLibraryConfig();
    return listAdminDigests(await getDatabaseForConfig(config), config, querySchema.parse(Object.fromEntries(request.nextUrl.searchParams)));
  });
}
