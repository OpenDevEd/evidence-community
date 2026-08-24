import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getLibraryConfig } from "@/config/library-config/server";

export const ADMIN_SESSION_COOKIE = "__Host-evidence_library_admin";
export const ADMIN_DEVELOPMENT_SESSION_COOKIE = "evidence_library_admin";
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

const adminRoleSchema = z.enum(["owner", "editor"]);

export const ADMIN_CONTENT_PERMISSION = "content:manage";
export const ADMIN_LIBRARY_PERMISSION = "library:manage";

export type AdminPermission =
	| typeof ADMIN_CONTENT_PERMISSION
	| typeof ADMIN_LIBRARY_PERMISSION;
export type AdminRole = z.infer<typeof adminRoleSchema>;

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
	| { status: "unauthenticated" };

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

export function adminRoleHasPermission(
	role: AdminRole,
	permission: AdminPermission,
) {
	return permission === ADMIN_CONTENT_PERMISSION || role === "owner";
}

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

async function getAdminSession(
	token: string | undefined,
	config?: AdminSessionSigningConfig,
) {
	config ??= await getAdminAccessConfig();
	return verifyAdminSessionToken(token, config);
}

export async function authorizeAdminSession(
	token: string | undefined,
	permission: AdminPermission,
	config?: AdminSessionSigningConfig,
): Promise<AdminSessionAuthorization> {
	const session = await getAdminSession(token, config);
	if (!session) return { status: "unauthenticated" };
	if (!adminRoleHasPermission(session.role, permission)) {
		return { session, status: "forbidden" };
	}
	return { session, status: "authorized" };
}
