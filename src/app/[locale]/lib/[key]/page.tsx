import { getTranslations } from "next-intl/server";
import { getCachedItemPage, getCachedItemSmall } from "@/app/api/cache";
import { Item } from "@/app/api/item/types";
import { Metadata } from "next";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRecordCitationLinks } from "@/config/library-config/exports";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL, getExtraValues } from "@/lib/utils";
import ServerComponent from "./ServerComponent";
import { getDatabaseForConfig } from "@/db";
import { readWithdrawnRecord } from "@/lib/withdrawn-record";
import ItemRoute from "./ItemRoute";
import type { ItemGetResponse } from "@/app/api/item/types";
import { PageBoundary } from "@/components/layout/PageBoundary";
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
		// A withdrawn record's page is its tombstone, named after it and kept out of search engines.
		const withdrawn = await readWithdrawnRecord(await getDatabaseForConfig(libraryConfig), params.key, libraryConfig);
		if (withdrawn) return { title: (await getTranslations("ui"))("recordWithdrawnTitle", { title: withdrawn.title }), generator: "new-el", robots: { index: false, follow: false } };
		return {
			title: (await getTranslations("ui"))("notFoundTitle"),
			description: (await getTranslations("ui"))("notFoundTitle"),
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
			// One address in every language: a record's title and abstract aren't translated, so its language versions
			// name this one as canonical and no language alternates are listed.
			canonical: buildSiteUrl(`/lib/${item.key}`, baseUrl),
			// Only advertise a citation file the library actually serves, and the PDF when it has one.
			types: Object.fromEntries([
				...getRecordCitationLinks(
					libraryConfig.exports,
					libraryConfig.features.downloads,
					item.key,
				).map((link) => [
					link.contentType,
					buildSiteUrl(link.path, baseUrl),
				]),
				...(pdfWithImage ? [["application/pdf", buildSiteUrl(`/lib/${item.key}/download/${pdfWithImage.key}`, baseUrl)]] : []),
			]),
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
// record; ServerComponent answers a missing record with the not-found page. A crawler gets both in place, with no
// stand-in before them (PageBoundary).
export default function ItemPage(props: {
	params: Promise<{ key: string }>;
}) {
	const recordKey = props.params.then(({ key }) => key);
	const record = recordKey.then((key) => getCachedItemPage(key)) as Promise<ItemGetResponse | null>;
	return (
		<>
			<PageBoundary fallback={<LoadingComponent />}>
				<ItemRoute record={record} />
			</PageBoundary>
			<PageBoundary fallback={null}>
				<ServerComponent record={record} recordKey={recordKey} />
			</PageBoundary>
		</>
	);
}
