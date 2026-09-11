export const POLICY_DESTINATIONS = {
	privacy: { field: "privacyPolicy", path: "/privacy" },
	cookiePolicy: { field: "cookiePolicy", path: "/cookie-policy" },
	terms: { field: "termsOfService", path: "/terms" },
} as const;

export type PolicyDocumentKind = keyof typeof POLICY_DESTINATIONS;
const CONSENT_POLICY_PATHS = [POLICY_DESTINATIONS.privacy.path, POLICY_DESTINATIONS.cookiePolicy.path];

export function isPolicyPage(pathname: string) {
	const normalizedPathname = pathname.replace(/\/+$/, "") || "/";

	return CONSENT_POLICY_PATHS.some(
		(policyPath) =>
			normalizedPathname === policyPath ||
			normalizedPathname.endsWith(policyPath)
	);
}
