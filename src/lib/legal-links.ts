import { getRuntimePageAvailability } from "@/config/library-config/pages";
import type { LibraryPublicConfig, LibraryServerConfig } from "@/config/library-config/schema";
import { getRuntimePagePath } from "@/config/library-config/links";

export const POLICY_DESTINATIONS = {
	privacy: { field: "privacyPolicy", path: "/privacy" },
	cookiePolicy: { field: "cookiePolicy", path: "/cookie-policy" },
	terms: { field: "termsOfService", path: "/terms" },
} as const;

export type PolicyDocumentKind = keyof typeof POLICY_DESTINATIONS;
type LegalPageConfig = Pick<LibraryPublicConfig, "identity" | "legal">;

export function isPolicyPage(pathname: string, { identity, legal }: LegalPageConfig) {
	const path = getRuntimePagePath(pathname, identity.baseUrl);
	return Object.values(POLICY_DESTINATIONS).some(({ field, path: policyPath }) =>
		path === policyPath || Boolean(legal[field] && path === getRuntimePagePath(legal[field], identity.baseUrl))
	);
}

/** Self destinations need a document; cross-page redirects must terminate. */
export function policyRedirectIssues(config: LibraryServerConfig) {
	const { legal, identity: { baseUrl } } = config;
	if (!URL.canParse(baseUrl)) return [];
	const unavailablePages = new Set(Object.entries(getRuntimePageAvailability(config))
		.filter(([, available]) => !available).map(([path]) => path));
	const destinations = Object.values(POLICY_DESTINATIONS);
	return destinations.filter(source => legal[source.field]).flatMap((source) => {
		let current: (typeof destinations)[number] | undefined = source;
		const visited = new Set<string>();
		while (current) {
			if (visited.has(current.path)) return [{ field: source.field, message: "Policy links form a redirect loop. Choose a local policy page or an external destination." }];
			visited.add(current.path);
			const href: string | undefined = legal[current.field];
			const path: string | null = href && URL.canParse(href, baseUrl) ? getRuntimePagePath(href, baseUrl) : null;
			if (unavailablePages.has(path ?? "")) return [{ field: source.field, message: "This link leads to a page that is not available. Configure that page or choose another destination." }];
			if (!href || path === current.path) break;
			current = destinations.find((destination) => destination.path === path);
		}
		return [];
	});
}
