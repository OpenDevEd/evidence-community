import type { NextRequest } from "next/server";
import { z } from "zod";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson } from "@/lib/admin/http";
import { listDigestPapers } from "@/lib/notifications/editorial";

const querySchema = z.object({
  query: z.string().max(200).default(""),
  show: z.enum(["all", "reviews", "uncited"]).default("all"),
  sort: z.enum(["newest", "title", "author"]).default("newest"),
  page: z.coerce.number().int().positive().default(1),
  // The records the text cites as the editor has it, which may not be saved yet.
  cited: z.string().max(20_000).default("").transform(value => value.split(",").filter(key => /^[A-Z0-9]{8}$/.test(key))),
});

/** A page of the edition's publications to cite from. */
export function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const config = await getLibraryConfig();
    return listDigestPapers(await getDatabaseForConfig(config), config, z.string().uuid().parse((await params).id), query);
  });
}
