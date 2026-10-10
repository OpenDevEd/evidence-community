import type { NextRequest } from "next/server";
import { z } from "zod";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_CONTENT_PERMISSION, ADMIN_PUBLISH_PERMISSION, adminRoleHasPermission, type AdminSession } from "@/lib/admin/access";
import { adminForbiddenResponse, handleAdminJson, handleAdminResponse, readAdminJson, ADMIN_RESPONSE_HEADERS } from "@/lib/admin/http";
import { getAdminDigest, moveDigest, saveDigestDraft, type DigestActor } from "@/lib/notifications/editorial";
import { NextResponse } from "next/server";

type Context = { params: Promise<{ id: string }> };
const editionId = async ({ params }: Context) => z.string().uuid().parse((await params).id);
const revision = z.number().int().nonnegative();
const actor = (session: AdminSession): DigestActor => ({ id: session.clerkUserId, name: session.name, photo: session.image, role: session.role });

async function runtime() {
  const config = await getLibraryConfig();
  return { config, db: await getDatabaseForConfig(config) };
}

export function GET(request: NextRequest, context: Context) {
  return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
    const [id, { config, db }] = await Promise.all([editionId(context), runtime()]);
    return { digest: await getAdminDigest(db, config, id) };
  });
}

const saveSchema = z.object({ expectedRevision: revision, words: z.unknown() }).strict();

/** Saves the text in hand as the edition's draft. */
export function PUT(request: NextRequest, context: Context) {
  return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async session => {
    const body = saveSchema.parse(await readAdminJson(request));
    const [id, { config, db }] = await Promise.all([editionId(context), runtime()]);
    return { digest: await saveDigestDraft(db, config, { id, ...body }, actor(session)) };
  });
}

const actionSchema = z.object({ action: z.enum(["submit", "withdraw", "return", "publish"]), expectedRevision: revision }).strict();

/** Sends a draft for review, takes it back, sends it back, or publishes it. */
export function POST(request: NextRequest, context: Context) {
  return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async session => {
    const body = actionSchema.parse(await readAdminJson(request));
    if ((body.action === "publish" || body.action === "return") && !adminRoleHasPermission(session.role, ADMIN_PUBLISH_PERMISSION)) return adminForbiddenResponse(ADMIN_PUBLISH_PERMISSION);
    const [id, { config, db }] = await Promise.all([editionId(context), runtime()]);
    return NextResponse.json({ digest: await moveDigest(db, config, { id, ...body }, actor(session)) }, { headers: ADMIN_RESPONSE_HEADERS });
  });
}
