import type { LibraryServerConfig } from "@/config/library-config/schema";

export const OPENSCHOLAR_PROVIDER_ID = "openscholar";

type ProfileName = { name?: unknown; given_name?: unknown; family_name?: unknown };
type OpenScholarProfile = ProfileName & { sub?: unknown; picture?: unknown };

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
	if (typeof profile.sub !== "string" || !profile.sub) throw new Error("OpenScholar sent a profile without a user ID");
	return {
		email: `${profile.sub}@readers.openscholar.invalid`,
		emailVerified: true,
		name: openScholarProfileName(profile),
		image: typeof profile.picture === "string" ? profile.picture : undefined,
	};
}

export function openScholarDiscoveryUrl(config: LibraryServerConfig) {
	return new URL("/.well-known/openid-configuration", config.authentication.openScholar.oauth.issuer).toString();
}
