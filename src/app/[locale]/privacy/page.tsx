import { getRuntimeLinkHref } from "@/config/library-config/links";
import PolicyPage from "@/components/pages/PolicyPage";
import { getPolicyMetadata, loadPolicyPageDocument } from "@/lib/policy-documents";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { connection } from "next/server";

const description =
	"Privacy notice describing how personal information is collected, used, and shared.";

export async function generateMetadata(): Promise<Metadata> {
	await connection();
	const config = await getLibraryConfig();
	return getPolicyMetadata("Privacy Policy", description, config.identity.name);
}

export default async function PrivacyPage() {
	await connection();
	const config = await getLibraryConfig();
	const [document, tFooter] = await Promise.all([
		loadPolicyPageDocument(config, "privacy"),
		getTranslations("footer"),
	]);

	return (
		<PolicyPage
			content={document!.content}
			title="Privacy Policy"
			description="How this public library collects, uses, stores, and protects personal information across support, analytics, and site operations."
			lastUpdated={document!.lastUpdated}
			otherPolicyLink={{
				href: getRuntimeLinkHref(config.legal.cookiePolicy, config.identity.baseUrl),
				label: tFooter("cookiePolicy"),
			}}
			contactEmail={config.contact.email}
		/>
	);
}
