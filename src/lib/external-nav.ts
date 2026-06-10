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

function normalizeExternalHref(href: string, sourceOrigin: string) {
	if (!href) return href;

	try {
		return new URL(href, sourceOrigin).href;
	} catch {
		return href;
	}
}

function normalizeLinkObject(link: LinkObject, sourceOrigin: string): LinkObject {
	return {
		...link,
		href: normalizeExternalHref(link.href, sourceOrigin),
		dropdown: link.dropdown?.map((child) => normalizeLinkObject(child, sourceOrigin)),
	};
}

function normalizeCompanyFooter(
	companyFooter: ExternalNavResponse["companyFooter"],
	sourceOrigin: string,
) {
	const normalizedCompanyFooter: Partial<CompanyFooter> = { ...companyFooter };

	if (companyFooter.privacyPolicy) {
		normalizedCompanyFooter.privacyPolicy = normalizeExternalHref(
			companyFooter.privacyPolicy,
			sourceOrigin,
		);
	}

	if (companyFooter.termsOfService) {
		normalizedCompanyFooter.termsOfService = normalizeExternalHref(
			companyFooter.termsOfService,
			sourceOrigin,
		);
	}

	return normalizedCompanyFooter;
}

function mapPolicyLinks(policyLinks: ExternalNavResponse["policyLinks"], sourceOrigin: string): Partial<CompanyFooter> {
	const companyFooter: Partial<CompanyFooter> = {};

	for (const link of policyLinks ?? []) {
		const label = link.label.toLowerCase();

		if (label.includes("privacy")) {
			companyFooter.privacyPolicy = normalizeExternalHref(link.url, sourceOrigin);
		} else if (label.includes("terms")) {
			companyFooter.termsOfService = normalizeExternalHref(link.url, sourceOrigin);
		} else if (label.includes("cookie")) {
			companyFooter.cookiePolicy = normalizeExternalHref(link.url, sourceOrigin);
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
		const sourceOrigin = new URL(url).origin;
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
				href: normalizeExternalHref(link.href, sourceOrigin),
			})),
		}));

		return {
			links: data.links.map((link) => normalizeLinkObject(link, sourceOrigin)),
			footerSections,
			externalLinks: data.externalLinks,
			companyFooter: {
				...mapPolicyLinks(data.policyLinks, sourceOrigin),
				...normalizeCompanyFooter(data.companyFooter, sourceOrigin),
			},
		};
	} catch (error) {
		console.warn("[external-nav] Error fetching external nav:", error);
		return null;
	}
}
