import { getRuntimeLinkHref } from "@/config/library-config/links";
import PolicyPage from "@/components/pages/PolicyPage";
import { getPolicyMetadata, loadPolicyPageDocument } from "@/lib/policy-documents";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getLibraryConfig } from "@/config/library-config/server";
import { connection } from "next/server";

const description = "Terms of service for using this public library.";

export async function generateMetadata(): Promise<Metadata> {
	await connection();
	const config = await getLibraryConfig();
	return getPolicyMetadata(
		"Terms of Service",
		description,
		config.identity.name,
	);
}

export default async function TermsPage() {
	await connection();
	const config = await getLibraryConfig();
	const [document, tFooter] = await Promise.all([
		loadPolicyPageDocument(config, "terms"),
		getTranslations("footer"),
	]);
	if (!document) notFound();

	return (
		<PolicyPage
			content={document.content}
			title="Terms of Service"
			description="The rules for using this public library and its content."
			lastUpdated={document.lastUpdated}
			otherPolicyLink={{
				href: getRuntimeLinkHref(config.legal.privacyPolicy, config.identity.baseUrl),
				label: tFooter("privacyPolicy"),
			}}
			contactEmail={config.contact.email}
		/>
	);
}
