import { getCachedStatus } from "@/app/api/cache";
import PolicyPage from "@/components/pages/PolicyPage";
import {
	getPolicyMetadata,
	readPolicyDocument,
} from "@/lib/policy-documents";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
	const status = await getCachedStatus();

	return getPolicyMetadata(
		"Privacy Policy",
		"Privacy notice describing how personal information is collected, used, and shared.",
		status.companyName
	);
}

export default async function PrivacyPage() {
	const [content, tFooter, tNav] = await Promise.all([
		readPolicyDocument("privacy"),
		getTranslations("footer"),
		getTranslations("nav"),
	]);

	return (
		<PolicyPage
			content={content}
			otherPolicyLink={{
				href: "/cookie-policy",
				label: tFooter("cookiePolicy"),
			}}
			homeLabel={tNav("home")}
		/>
	);
}
