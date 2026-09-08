import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { publicationIdentifier } from "@/db/schema/publication";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, readAdminPermission } from "@/lib/admin/http";
import { reserveCrossrefDoi } from "@/lib/publication/crossref-activation-service";

type Context = { params: Promise<{ key: string }> };
export async function GET(request: NextRequest, { params }: Context) {
 const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
 if (access.denied) return access.denied;
 try {
  const [{key}, config] = await Promise.all([params, getLibraryConfig()]);
  const db = await getDatabaseForConfig(config);
  const [reservation] = await db.select({doi: publicationIdentifier.doi, lifecycle: publicationIdentifier.lifecycle}).from(publicationIdentifier).where(and(eq(publicationIdentifier.itemKey, key), eq(publicationIdentifier.registrar, "crossref"), eq(publicationIdentifier.environment, config.services.publication.crossref.environment), eq(publicationIdentifier.role, "primary"), eq(publicationIdentifier.isCurrent, true)));
  return NextResponse.json({reservation: reservation ?? null}, {headers: ADMIN_RESPONSE_HEADERS});
 } catch(error) { return adminErrorResponse(error); }
}
export async function POST(request: NextRequest, { params }: Context) {
 const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
 if (access.denied) return access.denied;
 try {
  const [{key}, config] = await Promise.all([params, getLibraryConfig()]);
  const db = await getDatabaseForConfig(config);
  const reservation = await reserveCrossrefDoi(db, key, config, access.session.clerkUserId);
  return NextResponse.json({reservation}, {headers: ADMIN_RESPONSE_HEADERS});
 } catch(error) { return adminErrorResponse(error); }
}
