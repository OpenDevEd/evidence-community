import PolicyPage from "@/components/pages/PolicyPage";
import { getPolicyMetadata, loadPolicyDocument } from "@/lib/policy-documents";
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

export default async function CookiePolicyPage() {
	await connection();
	const config = await getLibraryConfig();
	const [document, tFooter, tNav] = await Promise.all([
		loadPolicyDocument(config, "cookiePolicy"),
		getTranslations("footer"),
		getTranslations("nav"),
	]);

	return (
		<PolicyPage
			content={document!.content}
			title="Cookie Policy"
			description="Which cookies and local storage entries the site uses, which are essential, and which only activate after analytics consent is granted."
			lastUpdated={document!.lastUpdated}
			otherPolicyLink={{
				href: "/privacy",
				label: tFooter("privacyPolicy"),
			}}
			homeLabel={tNav("home")}
		/>
	);
}
