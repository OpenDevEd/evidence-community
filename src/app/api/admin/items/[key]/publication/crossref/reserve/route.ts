import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { publicationIdentifier } from "@/db/schema/publication";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson } from "@/lib/admin/http";
import { reserveCrossrefDoi } from "@/lib/publication/crossref-activation-service";

type Context = { params: Promise<{ key: string }> };
export function GET(request: NextRequest, { params }: Context) {
 return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
  const [{key}, config] = await Promise.all([params, getLibraryConfig()]);
  const db = await getDatabaseForConfig(config);
  const [reservation] = await db.select({doi: publicationIdentifier.doi, lifecycle: publicationIdentifier.lifecycle}).from(publicationIdentifier).where(and(eq(publicationIdentifier.itemKey, key), eq(publicationIdentifier.registrar, "crossref"), eq(publicationIdentifier.environment, config.services.publication.crossref.environment), eq(publicationIdentifier.role, "primary"), eq(publicationIdentifier.isCurrent, true)));
  return {reservation: reservation ?? null};
 });
}
export function POST(request: NextRequest, { params }: Context) {
 return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async session => {
  const [{key}, config] = await Promise.all([params, getLibraryConfig()]);
  const db = await getDatabaseForConfig(config);
  const reservation = await reserveCrossrefDoi(db, key, config, session.clerkUserId);
  return {reservation};
 });
}
