import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "__Host-evidence_library_admin";
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

export const adminSessionCookieOptions = {
	httpOnly: true,
	maxAge: ADMIN_SESSION_TTL_MS / 1_000,
	path: "/",
	sameSite: "strict",
	secure: true,
} as const;

export type AdminCredentials = {
	password: string;
	secret: string;
};

function digest(value: string) {
	return createHash("sha256").update(value).digest();
}

function fingerprintPassword(credentials: AdminCredentials) {
	return createHmac("sha256", credentials.secret)
		.update(credentials.password)
		.digest("base64url");
}

function sign(payload: string, secret: string) {
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function adminPasswordMatches(
	candidate: string,
	credentials: AdminCredentials,
) {
	return timingSafeEqual(digest(candidate), digest(credentials.password));
}

export function createAdminSessionToken(
	credentials: AdminCredentials,
	now = Date.now(),
) {
	const payload = Buffer.from(
		JSON.stringify({
			expiresAt: now + ADMIN_SESSION_TTL_MS,
			password: fingerprintPassword(credentials),
			version: 1,
		}),
	).toString("base64url");
	return `${payload}.${sign(payload, credentials.secret)}`;
}

export function verifyAdminSessionToken(
	token: string | undefined,
	credentials: AdminCredentials,
	now = Date.now(),
) {
	if (!token) return false;
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra) return false;

	const expectedSignature = sign(payload, credentials.secret);
	if (!timingSafeEqual(digest(signature), digest(expectedSignature))) return false;

	try {
		const session = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as Record<string, unknown>;
		return (
			session.version === 1 &&
			typeof session.expiresAt === "number" &&
			session.expiresAt > now &&
			session.password === fingerprintPassword(credentials)
		);
	} catch {
		return false;
	}
}
