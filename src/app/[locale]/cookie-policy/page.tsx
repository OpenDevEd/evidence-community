import PolicyPage from "@/components/pages/PolicyPage";
import {
	getPolicyMetadata,
	readPolicyDocument,
} from "@/lib/policy-documents";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPolicyLastModified } from "@/lib/policy-documents";

export const metadata: Metadata = getPolicyMetadata(
	"Cookie Policy",
	"Cookie notice covering cookies and similar browser storage used by the site."
);

export default async function CookiePolicyPage() {
	const [content, tFooter, tNav, lastUpdated] = await Promise.all([
		readPolicyDocument("cookiePolicy"),
		getTranslations("footer"),
		getTranslations("nav"),
		getPolicyLastModified("cookiePolicy"),
	]);

	return (
		<PolicyPage
			content={content}
			title="Cookie Policy"
			description="Which cookies and local storage entries the site uses, which are essential, and which only activate after analytics consent is granted."
			lastUpdated={lastUpdated}
			variant="cookie"
			otherPolicyLink={{
				href: "/privacy",
				label: tFooter("privacyPolicy"),
			}}
			homeLabel={tNav("home")}
		/>
	);
}
