import PolicyPage from "@/components/pages/PolicyPage";
import {
	getPolicyMetadata,
	readPolicyDocument,
} from "@/lib/policy-documents";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPolicyLastModified } from "@/lib/policy-documents";

export const metadata: Metadata = getPolicyMetadata(
	"Privacy Policy",
	"Privacy notice describing how personal information is collected, used, and shared."
);

export default async function PrivacyPage() {
	const [content, tFooter, tNav, lastUpdated] = await Promise.all([
		readPolicyDocument("privacy"),
		getTranslations("footer"),
		getTranslations("nav"),
		getPolicyLastModified("privacy"),
	]);

	return (
		<PolicyPage
			content={content}
			title="Privacy Policy"
			description="How this public library collects, uses, stores, and protects personal information across support, analytics, and site operations."
			lastUpdated={lastUpdated}
			variant="privacy"
			otherPolicyLink={{
				href: "/cookie-policy",
				label: tFooter("cookiePolicy"),
			}}
			homeLabel={tNav("home")}
		/>
	);
}
