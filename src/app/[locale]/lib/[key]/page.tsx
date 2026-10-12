import { getCachedItemPage, getCachedItemSmall } from "@/app/api/cache";
import { Item } from "@/app/api/item/types";
import { Metadata } from "next";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { buildLanguageAlternates } from "@/lib/language-alternates";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRecordCitationLinks } from "@/config/library-config/exports";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL, getExtraValues } from "@/lib/utils";
import ServerComponent from "./ServerComponent";
import ItemRoute from "./ItemRoute";
import type { ItemGetResponse } from "@/app/api/item/types";
import { Suspense } from "react";
import LoadingComponent from "./LoadingComponent";


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
	const [data, libraryConfig] = await Promise.all([
		getCachedItemSmall(params.key),
		getLibraryConfig(),
	]);
	const baseUrl = libraryConfig.identity.baseUrl;

	if (!data || !data.item) {
		return {
			title: "404 - Not Found",
			description: "404 - Not Found",
			generator: "new-el",
			robots: { index: false, follow: false },
		};
	}

	const item: Item = data.item;
	const authors = (item.creators ?? []).filter(creator => creator.creatorType === "author").map(creatorDisplayName).filter(Boolean);
	const extraValues = getExtraValues(item.extra ?? "");
	const pdfWithImage = item.attachmentsData?.find(
		(a: any) => a.PDFCoverPageImage
	);

	const shareImage = pdfWithImage?.PDFCoverPageImage
		? { url: convertToImageURL(pdfWithImage.PDFCoverPageImage), width: pdfWithImage.PDFCoverPageWidth ?? undefined, height: pdfWithImage.PDFCoverPageHeight ?? undefined, alt: item.title ?? "" }
		: { url: libraryConfig.identity.assets.shareImage ?? buildSiteUrl(`/lib/${item.key}/share-image`, baseUrl), alt: item.title ?? "" };

	return {
		title: item.title,
		description: item.abstractNote,
		generator: "new-el",
		alternates: {
			canonical: buildSiteUrl(`/lib/${item.key}`, baseUrl),
			languages: buildLanguageAlternates(
				`/lib/${item.key}`,
				libraryConfig.localization,
				baseUrl,
			),
			// Only advertise a citation file the library actually serves.
			types: Object.fromEntries(
				getRecordCitationLinks(
					libraryConfig.exports,
					libraryConfig.features.downloads,
					item.key,
				).map((link) => [
					link.contentType,
					buildSiteUrl(link.path, baseUrl),
				]),
			),
			media: {
				"image/jpeg": pdfWithImage
					? convertToImageURL(pdfWithImage.PDFCoverPageImage ?? "")
					: null,
				"application/pdf": pdfWithImage
					? buildSiteUrl(`/lib/${item.key}/download/${pdfWithImage.key}`, baseUrl)
					: null,
			},
		},
		other: {
			citation_title: item.title ?? "",
			citation_publication_date: item.date ?? "",
			citation_date: item.date ?? "",
			citation_year: item.year ?? "",

			citation_author: authors,

			citation_volume: item.volume ?? "",
			citation_issue: item.issue ?? "",
			citation_language: item.languageName ?? "",
			citation_publisher: item.publisher ?? "",
			citation_firstpage: getPages(item.pages ?? "").firstPage ?? "",
			citation_lastpage: getPages(item.pages ?? "").lastPage ?? "",

			citation_conference_title: item.conferenceName ?? "",
			citation_journal_title: item.publicationTitle ?? "",
			citation_dissertation_institution:
				item.itemType === "Thesis" ? (item.publisher ?? "") : "",
			citation_technical_report_institution:
				item.itemType === "Report" ? (item.publisher ?? "") : "",
			citation_technical_report_number:
				item.itemType === "Report" ? (item.number ?? "") : "",

			citation_isbn: item.ISBN ?? extraValues.get("ISBN") ?? "",
			citation_issn: item.ISSN ?? extraValues.get("ISSN") ?? "",
			citation_doi: item.DOI ?? extraValues.get("DOI") ?? "",

			citation_public_url: item.url ?? "",
			citation_pdf_url: pdfWithImage
				? buildSiteUrl(`/lib/${item.key}/download/${pdfWithImage.key}`, baseUrl)
				: "",
		},
		twitter: {
			card: "summary_large_image",
			title: item.title ?? "",
			description: item.abstractNote ?? "",
			images: [shareImage],
		},
		openGraph: {
			title: item.title ?? "",
			description: item.abstractNote ?? "",
			url: buildSiteUrl(`/lib/${item.key}`, baseUrl),
			siteName: libraryConfig.identity.name,
			images: [shareImage],
			locale: libraryConfig.localization.defaultLocale.includes("-")
				? libraryConfig.localization.defaultLocale.replaceAll("-", "_")
				: undefined,
			type: "article",
			authors,
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

// Nothing is awaited here, so a click shows the page at once. ItemRoute draws the page from the list copy or the
// record; ServerComponent answers a missing record with the not-found page.
export default function ItemPage(props: {
	params: Promise<{ key: string }>;
}) {
	const record = props.params.then(({ key }) => getCachedItemPage(key)) as Promise<ItemGetResponse | null>;
	return (
		<>
			<Suspense fallback={<LoadingComponent />}>
				<ItemRoute record={record} />
			</Suspense>
			<Suspense fallback={null}>
				<ServerComponent record={record} />
			</Suspense>
		</>
	);
}
