import type { CompanyFooter, ExternalLinks, FooterLinkSection, LinkObject } from "@/db/schema/tables/status";
import { cacheLife, cacheTag } from "next/cache";

type ExternalNavResponse = {
	links: LinkObject[];
	footerSections: {
		title: string;
		links: { label: string; href: string }[];
	}[];
	externalLinks: Record<string, string>;
	companyFooter: {
		email?: string;
		address?: string;
		privacyPolicy?: string;
		termsOfService?: string;
	};
	policyLinks?: {
		label: string;
		url: string;
	}[];
};

export type ExternalNavResult = {
	links: LinkObject[];
	footerSections: FooterLinkSection[];
	externalLinks: ExternalLinks;
	companyFooter: Partial<CompanyFooter>;
};

function mapPolicyLinks(policyLinks: ExternalNavResponse["policyLinks"]): Partial<CompanyFooter> {
	const companyFooter: Partial<CompanyFooter> = {};

	for (const link of policyLinks ?? []) {
		const label = link.label.toLowerCase();

		if (label.includes("privacy")) {
			companyFooter.privacyPolicy = link.url;
		} else if (label.includes("terms")) {
			companyFooter.termsOfService = link.url;
		} else if (label.includes("cookie")) {
			companyFooter.cookiePolicy = link.url;
		}
	}

	return companyFooter;
}

export async function fetchExternalNav(): Promise<ExternalNavResult | null> {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('external-nav')

	const url = process.env.EXTERNAL_NAV_SOURCE_URL;
	if (!url) return null;

	try {
		const res = await fetch(url);

		if (!res.ok) {
			console.warn(`[external-nav] Failed to fetch from ${url}: ${res.status} ${res.statusText}`);
			return null;
		}

		const data: ExternalNavResponse = await res.json();

		const footerSections: FooterLinkSection[] = data.footerSections.map((section) => ({
			title: section.title,
			links: section.links.map((link) => ({
				label: link.label,
				href: link.href,
			})),
		}));

		return {
			links: data.links,
			footerSections,
			externalLinks: data.externalLinks,
			companyFooter: {
				...mapPolicyLinks(data.policyLinks),
				...data.companyFooter,
			},
		};
	} catch (error) {
		console.warn("[external-nav] Error fetching external nav:", error);
		return null;
	}
}
