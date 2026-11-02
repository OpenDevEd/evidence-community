import { getRuntimeLinkHref } from "@/config/library-config/links";
import PolicyPage from "@/components/pages/PolicyPage";
import { getPolicyMetadata, loadPolicyPageDocument } from "@/lib/policy-documents";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getLibraryConfig } from "@/config/library-config/server";
import { connection } from "next/server";

// Waits for the library settings instead of showing a loading state, so the click lands on the finished page.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
	await connection();
	const config = await getLibraryConfig();
	const t = await getTranslations("policyPages");
	return getPolicyMetadata(t("terms.title"), t("terms.metaDescription"), config.identity.name);
}

export default async function TermsPage() {
	await connection();
	const config = await getLibraryConfig();
	const [document, tFooter, tPolicy] = await Promise.all([
		loadPolicyPageDocument(config, "terms"),
		getTranslations("footer"),
		getTranslations("policyPages"),
	]);
	if (!document) notFound();

	return (
		<PolicyPage
			content={document.content}
			title={tPolicy("terms.title")}
			description={tPolicy("terms.description")}
			lastUpdated={document.lastUpdated}
			otherPolicyLink={{
				href: getRuntimeLinkHref(config.legal.privacyPolicy, config.identity.baseUrl),
				label: tFooter("privacyPolicy"),
			}}
			contactEmail={config.contact.email}
		/>
	);
}
