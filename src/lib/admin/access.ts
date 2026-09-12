import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getLibraryConfig } from "@/config/library-config/server";

import {
	adminRoleSchema,
	adminRoleHasPermission,
	type AdminPermission,
} from "./permissions";

export const ADMIN_SESSION_COOKIE = "__Host-evidence_library_admin";
export const ADMIN_DEVELOPMENT_SESSION_COOKIE = "evidence_library_admin";
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

export {
	ADMIN_CONTENT_PERMISSION,
	ADMIN_PUBLISH_PERMISSION,
	ADMIN_LIBRARY_PERMISSION,
	adminRoleHasPermission,
	type AdminPermission,
} from "./permissions";

export const adminSessionIdentitySchema = z
	.object({
		clerkOrganizationId: z.string().trim().min(1).max(512),
		clerkUserId: z.string().trim().min(1).max(512),
		consumedAt: z.number().int().nonnegative(),
		libraryId: z.string().trim().min(1).max(128),
		role: adminRoleSchema,
	})
	.strict();

const adminSessionSchema = adminSessionIdentitySchema
	.extend({
		expiresAt: z.number().int().positive(),
		version: z.literal(2),
	})
	.strict();

export type AdminSessionIdentity = z.infer<
	typeof adminSessionIdentitySchema
>;
export type AdminSession = AdminSessionIdentity & { expiresAt: number };

export type AdminSessionAuthorization =
	| { session: AdminSession; status: "authorized" }
	| { session: AdminSession; status: "forbidden" }
	| { status: "unauthenticated" }
	| { status: "unavailable" };

export type AdminAccessConfig = {
	convexSiteUrl: string;
	libraryId: string;
	loginPageUrl: string;
	machineCredential: string;
	secret: string;
};

export type AdminSessionSigningConfig = Pick<
	AdminAccessConfig,
	"libraryId" | "secret"
>;

export function adminSessionCookieOptions(environment = process.env.NODE_ENV) {
	return {
		httpOnly: true,
		maxAge: ADMIN_SESSION_TTL_MS / 1_000,
		path: "/",
		sameSite: "lax" as const,
		secure: environment === "production",
	};
}

export function adminSessionCookieName(environment = process.env.NODE_ENV) {
	return environment === "production"
		? ADMIN_SESSION_COOKIE
		: ADMIN_DEVELOPMENT_SESSION_COOKIE;
}

export async function getAdminAccessConfig(): Promise<AdminAccessConfig> {
	const authentication = (await getLibraryConfig()).authentication;
	return {
		...authentication.openScholar,
		secret: authentication.secret,
	};
}

function digest(value: string) {
	return createHash("sha256").update(value).digest();
}

function sign(payload: string, secret: string) {
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminSessionToken(
	identity: AdminSessionIdentity,
	config: AdminSessionSigningConfig,
	now = Date.now(),
) {
	if (identity.libraryId !== config.libraryId) {
		throw new Error("Admin session library does not match this runtime");
	}
	const payload = Buffer.from(
		JSON.stringify({
			...identity,
			expiresAt: now + ADMIN_SESSION_TTL_MS,
			version: 2,
		}),
	).toString("base64url");
	return `${payload}.${sign(payload, config.secret)}`;
}

export function verifyAdminSessionToken(
	token: string | undefined,
	config: AdminSessionSigningConfig,
	now = Date.now(),
): AdminSession | null {
	if (!token) return null;
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra) return null;

	const expectedSignature = sign(payload, config.secret);
	if (!timingSafeEqual(digest(signature), digest(expectedSignature))) {
		return null;
	}

	try {
		const result = adminSessionSchema.safeParse(
			JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
		);
		if (
			!result.success ||
			result.data.expiresAt <= now ||
			result.data.libraryId !== config.libraryId
		) {
			return null;
		}
		const { version: _version, ...session } = result.data;
		return session;
	} catch {
		return null;
	}
}

export async function authorizeAdminSession(
  token: string | undefined,
  permission: AdminPermission,
  config?: AdminAccessConfig,
): Promise<AdminSessionAuthorization> {
  config ??= await getAdminAccessConfig();
  const signedSession = verifyAdminSessionToken(token, config);
  if (!signedSession) return { status: "unauthenticated" };
  let response: Response;
  try {
    response = await fetch(new URL("/api/v1/evidence-libraries/admin-session/check", config.convexSiteUrl), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.machineCredential}` },
      body: JSON.stringify({ libraryId: config.libraryId, clerkUserId: signedSession.clerkUserId }),
    });
  } catch (error) {
    console.error("Admin access check unavailable", { libraryId: config.libraryId, error });
    return { status: "unavailable" };
  }
  if (!response.ok) {
    if (response.status !== 403) console.error("Admin access check rejected", { libraryId: config.libraryId, status: response.status });
    return { status: response.status === 403 ? "unauthenticated" : "unavailable" };
  }
  const result = z.object({ role: adminRoleSchema }).safeParse(await response.json().catch(() => null));
  if (!result.success) {
    console.error("Invalid admin access response", { libraryId: config.libraryId });
    return { status: "unavailable" };
  }
  const session = { ...signedSession, role: result.data.role };
  return { session, status: adminRoleHasPermission(session.role, permission) ? "authorized" : "forbidden" };
}
