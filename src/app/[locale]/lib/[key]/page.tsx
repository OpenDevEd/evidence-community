import { getItem } from "@/app/api/item/[key]/route";
import { db } from "@/db";
import {
	getCachedItem,
	getCachedItemSmall,
	getCachedStatus,
} from "@/app/api/cache";
import { Item, ItemGetResponse } from "@/app/api/item/types";
import { Metadata } from "next";
import { buildLanguageAlternates } from "@/lib/language-alternates";
import { getLibraryConfig } from "@/config/library-config/server";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL, getExtraValues, parseCompanyName } from "@/lib/utils";
import ServerComponent from "./ServerComponent";
import { Suspense } from "react";
import LoadingComponent from "./LoadingComponent";

// export async function generateStaticParams() {
// 	if (process.env.SHOULD_GENERATE_STATIC_PAGES === "true") {
// 		const documents = await db.query.item.findMany({
// 			columns: {
// 				key: true,
// 				parentItem: true,
// 			},
// 		});

// 		return documents.flatMap((item) =>
// 			routing.locales.map((locale) => ({
// 				locale,
// 				key: item.parentItem ? item.parentItem : item.key,
// 			}))
// 		);
// 	}
// }

export async function getCurrentItem(key: string) {
	const data = await getCachedItemSmall(key).catch(() => ({
		item: undefined,
	}));

	if (data?.item && !data.item.citation) {
		data.item.citation = "<div>Loading...</div>";
	}

	return data;
}

function getPages(pages: string): { firstPage?: string; lastPage?: string } {
	if (!pages) return {};

	const normalizedPages = pages.replace(/[-\u2013]/g, "-");

	const pageParts = normalizedPages.split(/\s*-\s*/);

	return {
		firstPage: pageParts[0]?.trim() || undefined,
		lastPage: pageParts[1]?.trim() || undefined,
	};
}

export async function generateMetadata(props: {
	params: Promise<{ key: string }>;
}): Promise<Metadata> {
	const params = await props.params;
	const [data, status, libraryConfig] = await Promise.all([
		getCurrentItem(params.key),
		getCachedStatus(),
		getLibraryConfig(),
	]);

	const { companyName, siteName } = parseCompanyName(status.companyName);

	if (!data || !data.item) {
		return {
			title: "404 - Not Found",
			description: "404 - Not Found",
			generator: "new-el",
		};
	}

	const item: Item = data.item;
	const extraValues = getExtraValues(item.extra ?? "");
	const attachmentExists = item.attachmentsData?.find(
		(a: any) => a.PDFCoverPageImage
	);

	const fullTextPDFs = item.fullTextPDFs ?? [];

	const institution = Array.isArray(item.institution)
		? item.institution.join(", ")
		: item.institution;

	const pdfWithImage = item.attachmentsData?.find(
		(a: any) => a.PDFCoverPageImage
	);

	return {
		title: item.title,
		description: item.abstractNote,
		generator: "new-el",
		alternates: {
			canonical: buildSiteUrl(`/lib/${item.key}`),
			languages: buildLanguageAlternates(
				`/lib/${item.key}`,
				libraryConfig.localization,
			),
			types: {
				"application/x-research-info-systems": buildSiteUrl(`/lib/${item.key}/export/ris`),
				"application/x-bibtex": buildSiteUrl(`/lib/${item.key}/export/bibtex`),
			},
			media: {
				"image/jpeg": pdfWithImage
					? convertToImageURL(pdfWithImage.PDFCoverPageImage ?? "")
					: null,
				"application/pdf": pdfWithImage
					? buildSiteUrl(`/lib/${item.key}/download/${pdfWithImage.key}`)
					: null,
			},
		},
		other: {
			citation_title: item.title ?? "",
			citation_publication_date: item.date ?? "",
			citation_date: item.date ?? "",
			citation_year: item.year ?? "",

			citation_author:
				item.creators
					?.filter((creator: any) => creator.creatorType === "author")
					.map((creator: any) =>
						Object.entries(creator)
							.filter(([key]) => key !== "creatorType")
							.map(([_, value]) => value)
							.join(", ")
					) ?? [],

			citation_volume: item.volume ?? "",
			citation_issue: item.issue ?? "",
			citation_language: item.languageName ?? "",
			citation_publisher: item.publisher ?? "",
			citation_firstpage: getPages(item.pages ?? "").firstPage ?? "",
			citation_lastpage: getPages(item.pages ?? "").lastPage ?? "",

			citation_conference_title: item.conferenceName ?? "",
			citation_journal_title: item.publicationTitle ?? "",
			citation_dissertation_institution: item.university ?? "",
			citation_technical_report_institution: institution ?? "",
			citation_technical_report_number: item.reportNumber ?? "",

			citation_isbn: item.ISBN ?? extraValues.get("ISBN") ?? "",
			citation_issn: item.ISSN ?? extraValues.get("ISSN") ?? "",
			citation_doi: item.DOI ?? extraValues.get("DOI") ?? "",

			citation_public_url: item.url ?? "",
			citation_pdf_url: pdfWithImage
				? buildSiteUrl(`/lib/${item.key}/download/${pdfWithImage.key}`)
				: "",
		},
		openGraph: {
			title: item.title ?? "",
			description: item.abstractNote ?? "",
			url: buildSiteUrl(`/lib/${item.key}`),
			siteName: `${companyName} - ${siteName}`,
			images: [
				{
					url: pdfWithImage
						? convertToImageURL(
								pdfWithImage.PDFCoverPageImage ?? ""
						  )
						: "",
					width: pdfWithImage?.PDFCoverPageWidth ?? 1200,
					height: pdfWithImage?.PDFCoverPageHeight ?? 630,
					alt: item.title ?? "",
				},
			],
			locale: "en_GB",
			type: "article",
			authors:
				item.creators
					?.filter((creator: any) => creator.creatorType === "author")
					.map((creator: any) =>
						Object.entries(creator)
							.filter(([key]) => key !== "creatorType")
							.map(([_, value]) => value)
							.join(", ")
					) ?? [],
			publishedTime: item.date && !isNaN(new Date(item.date).getTime())
				? new Date(item.date).toISOString()
				: undefined,
			modifiedTime: (() => {
				const dateToUse = item.dateModified ?? item.date;
				return dateToUse && !isNaN(new Date(dateToUse).getTime())
					? new Date(dateToUse).toISOString()
					: undefined;
			})(),
		},
	};
}

export default async function ItemPage(props: {
	params: Promise<{ key: string }>;
}) {
	const params = await props.params;
	return (
		<Suspense fallback={<LoadingComponent itemKey={params.key} />}>
			<ServerComponent params={props.params} />
		</Suspense>
	);
}
