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
		"Cookie Policy",
		"Cookie notice covering cookies and similar browser storage used by the site.",
		status.companyName
	);
}

export default async function CookiePolicyPage() {
	const [content, tFooter, tNav] = await Promise.all([
		readPolicyDocument("cookiePolicy"),
		getTranslations("footer"),
		getTranslations("nav"),
	]);

	return (
		<PolicyPage
			content={content}
			otherPolicyLink={{
				href: "/privacy",
				label: tFooter("privacyPolicy"),
			}}
			homeLabel={tNav("home")}
		/>
	);
}
