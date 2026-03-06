import type { CompanyFooter } from "@/db/schema/tables/status";

export const INTERNAL_POLICY_ROUTES = {
	privacyPolicy: "/privacy",
	cookiePolicy: "/cookie-policy",
} as const;

export function resolveCompanyFooterPolicyLinks(
	footer?: CompanyFooter | null
) {
	return {
		privacyPolicy:
			footer?.privacyPolicy || INTERNAL_POLICY_ROUTES.privacyPolicy,
		cookiePolicy:
			footer?.cookiePolicy || INTERNAL_POLICY_ROUTES.cookiePolicy,
		termsOfService: footer?.termsOfService,
	};
}
