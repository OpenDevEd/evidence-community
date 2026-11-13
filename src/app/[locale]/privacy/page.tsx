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
	return getPolicyMetadata(t("privacy.title"), t("privacy.metaDescription"), config.identity.name);
}

export default async function PrivacyPage() {
	await connection();
	const config = await getLibraryConfig();
	const [document, tFooter, tPolicy] = await Promise.all([
		loadPolicyPageDocument(config, "privacy"),
		getTranslations("footer"),
		getTranslations("policyPages"),
	]);

	return (
		<PolicyPage
			content={document!.content}
			title={tPolicy("privacy.title")}
			description={tPolicy(analyticsCapabilities(config.analytics).analytics ? "privacy.description" : "privacy.descriptionNoAnalytics")}
			lastUpdated={document!.lastUpdated}
			otherPolicyLink={{
				href: getRuntimeLinkHref(config.legal.cookiePolicy, config.identity.baseUrl),
				label: tFooter("cookiePolicy"),
			}}
			contactEmail={config.contact.email}
		/>
	);
}
