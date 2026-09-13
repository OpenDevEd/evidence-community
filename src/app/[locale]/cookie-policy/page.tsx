import PageBoundary from "@/components/layout/PageBoundary";
import { getRuntimeLinkHref } from "@/config/library-config/links";
import PolicyPage from "@/components/pages/PolicyPage";
import { getPolicyMetadata, loadPolicyPageDocument } from "@/lib/policy-documents";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { connection } from "next/server";

const description =
	"Cookie notice covering cookies and similar browser storage used by the site.";

export async function generateMetadata(): Promise<Metadata> {
	await connection();
	const config = await getLibraryConfig();
	return getPolicyMetadata("Cookie Policy", description, config.identity.name);
}

async function CookiePolicyPageContent() {
	await connection();
	const config = await getLibraryConfig();
	const [document, tFooter] = await Promise.all([
		loadPolicyPageDocument(config, "cookiePolicy"),
		getTranslations("footer"),
	]);

	return (
		<PolicyPage
			content={document!.content}
			title="Cookie Policy"
			description="Which cookies and local storage entries the site uses, which are essential, and which only activate after analytics consent is granted."
			lastUpdated={document!.lastUpdated}
			otherPolicyLink={{
				href: getRuntimeLinkHref(config.legal.privacyPolicy, config.identity.baseUrl),
				label: tFooter("privacyPolicy"),
			}}
			contactEmail={config.contact.email}
		/>
	);
}

export default function CookiePolicyPage() {
	return (
		<PageBoundary>
			<CookiePolicyPageContent />
		</PageBoundary>
	);
}
