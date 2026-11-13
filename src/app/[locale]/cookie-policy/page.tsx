import { getRuntimeLinkHref } from "@/config/library-config/links";
import PolicyPage from "@/components/pages/PolicyPage";
import { getPolicyMetadata, loadPolicyPageDocument } from "@/lib/policy-documents";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { analyticsCapabilities } from "@/lib/analytics-consent";
import { connection } from "next/server";

// Waits for the library settings instead of showing a loading state, so the click lands on the finished page.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
	await connection();
	const config = await getLibraryConfig();
	const t = await getTranslations("policyPages");
	return getPolicyMetadata(t("cookie.title"), t("cookie.metaDescription"), config.identity.name);
}

export default async function CookiePolicyPage() {
	await connection();
	const config = await getLibraryConfig();
	const [document, tFooter, tPolicy] = await Promise.all([
		loadPolicyPageDocument(config, "cookiePolicy"),
		getTranslations("footer"),
		getTranslations("policyPages"),
	]);

	return (
		<PolicyPage
			content={document!.content}
			title={tPolicy("cookie.title")}
			// A community that runs no analytics has no storage that waits for consent.
			description={tPolicy(analyticsCapabilities(config.analytics).analytics ? "cookie.description" : "cookie.descriptionNoAnalytics")}
			lastUpdated={document!.lastUpdated}
			otherPolicyLink={{
				href: getRuntimeLinkHref(config.legal.privacyPolicy, config.identity.baseUrl),
				label: tFooter("privacyPolicy"),
			}}
			contactEmail={config.contact.email}
		/>
	);
}
