import type { LinkObject, ExternalLinks, CompanyFooter } from "@/db/schema/tables/status";
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
};

type ExternalNavResult = {
	links: LinkObject[];
	externalLinks: ExternalLinks;
	companyFooter: Partial<CompanyFooter>;
};

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

		const footerLinks: LinkObject[] = data.footerSections.flatMap((section) =>
			section.links.map((link) => ({
				label: link.label,
				href: link.href,
				section: section.title,
				navExclude: true,
			})),
		);

		return {
			links: [...data.links, ...footerLinks],
			externalLinks: data.externalLinks,
			companyFooter: data.companyFooter,
		};
	} catch (error) {
		console.warn("[external-nav] Error fetching external nav:", error);
		return null;
	}
}
