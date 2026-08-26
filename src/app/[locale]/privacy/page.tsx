import PolicyPage from "@/components/pages/PolicyPage";
import { getPolicyMetadata, loadPolicyDocument } from "@/lib/policy-documents";
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
	const [document, tFooter, tNav] = await Promise.all([
		loadPolicyDocument(config, "privacy"),
		getTranslations("footer"),
		getTranslations("nav"),
	]);

	return (
		<PolicyPage
			content={document!.content}
			title="Privacy Policy"
			description="How this public library collects, uses, stores, and protects personal information across support, analytics, and site operations."
			lastUpdated={document!.lastUpdated}
			otherPolicyLink={{
				href: "/cookie-policy",
				label: tFooter("cookiePolicy"),
			}}
			homeLabel={tNav("home")}
		/>
	);
}
