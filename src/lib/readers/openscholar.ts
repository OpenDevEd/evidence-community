import { createHash } from "node:crypto";

import type { LibraryServerConfig } from "@/config/library-config/schema";

export const OPENSCHOLAR_PROVIDER_ID = "openscholar";

type ProfileName = { name?: unknown; given_name?: unknown; family_name?: unknown };
type OpenScholarProfile = ProfileName & { sub?: unknown; picture?: unknown; email?: unknown };

/** Clerk sends no name for an account without one; the library then shows "Reader". */
export function openScholarProfileName(profile: ProfileName) {
	const parts = [profile.given_name, profile.family_name].filter(
		(part): part is string => typeof part === "string" && part.trim() !== "",
	);
	if (parts.length > 0) return parts.join(" ").trim();
	return typeof profile.name === "string" ? profile.name.trim() : "";
}

/**
 * The reader Better Auth keeps for one Clerk account. The email is made from
 * the Clerk user ID, never the real address: Better Auth matches readers by
 * email, and a real one can move to another Clerk account, which would then
 * sign in as this reader. The library has no use for the real address.
 */
export function openScholarReader(profile: OpenScholarProfile) {
	if (typeof profile.sub !== "string" || !profile.sub) throw new Error("Openscholar sent a profile without a user ID");
	return {
		email: `${profile.sub}@readers.openscholar.invalid`,
		emailVerified: true,
		name: openScholarProfileName(profile),
		image: typeof profile.picture === "string" ? profile.picture : undefined,
		// The real address, kept apart from the one sign-in matches by.
		contactEmail: typeof profile.email === "string" && profile.email ? profile.email : null,
	};
}

export function openScholarDiscoveryUrl(config: LibraryServerConfig) {
	return new URL("/.well-known/openid-configuration", config.authentication.openScholar.oauth.issuer).toString();
}

/**
 * The cookie Clerk keeps on the whole of OpenScholar's site, holding when its session last changed ("0" once nobody
 * is signed in). A community on that site reads it to follow the session (`session-follow.ts`). Clerk names it after
 * the instance's publishable key, which is made from its host. Null for a development instance: its sign-in session
 * lives on its own Account Portal site, apart from the OpenScholar app's, so there is nothing here to follow.
 */
export function openScholarSessionCookie(issuer: string) {
	const host = new URL(issuer).host;
	if (host.endsWith(".accounts.dev")) return null;
	const publishableKey = `pk_live_${Buffer.from(`${host}$`).toString("base64")}`;
	return `__client_uat_${createHash("sha1").update(publishableKey).digest("base64url").slice(0, 8)}`;
}
