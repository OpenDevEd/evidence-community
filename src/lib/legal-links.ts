import { getRuntimePagePath } from "@/config/library-config/links";

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

/** Self destinations show local text; cross-page redirects must terminate. */
export function policyRedirectCycleFields(
	legal: Partial<Record<(typeof POLICY_DESTINATIONS)[PolicyDocumentKind]["field"], string>>,
	baseUrl: string,
) {
	if (!URL.canParse(baseUrl)) return [];
	const destinations = Object.values(POLICY_DESTINATIONS);
	return destinations.filter((source) => {
		let current: (typeof destinations)[number] | undefined = source;
		const visited = new Set<string>();
		while (current) {
			if (visited.has(current.path)) return true;
			visited.add(current.path);
			const href = legal[current.field];
			if (!href || !URL.canParse(href, baseUrl)) break;
			const path = getRuntimePagePath(href, baseUrl);
			if (path === current.path) break;
			current = destinations.find((destination) => destination.path === path);
		}
		return false;
	}).map((destination) => destination.field);
}
