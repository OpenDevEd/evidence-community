import type { LibraryServerConfig } from "@/config/library-config/schema";

export const OPENSCHOLAR_PROVIDER_ID = "openscholar";

type ProfileName = { name?: unknown; given_name?: unknown; family_name?: unknown };

/** Clerk sends no name for an account without one; the library then shows "Reader". */
export function openScholarProfileName(profile: ProfileName) {
	const parts = [profile.given_name, profile.family_name].filter(
		(part): part is string => typeof part === "string" && part.trim() !== "",
	);
	if (parts.length > 0) return parts.join(" ").trim();
	return typeof profile.name === "string" ? profile.name.trim() : "";
}

export function openScholarDiscoveryUrl(config: LibraryServerConfig) {
	return new URL("/.well-known/openid-configuration", config.authentication.openScholar.oauth.issuer).toString();
}
