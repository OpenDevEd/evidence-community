import { ItemGetResponse } from "@/app/api/item/types";
import ItemComponent from "@/components/pages/Item";
import ItemPage from "@/components/features/newlib/ItemPage";
import { notFound } from "next/navigation";
import { getCachedItemSmall } from "@/app/api/cache";
import { Metadata } from "next";
import { getCachedStatus } from "@/app/api/cache";
import { Item } from "@/app/api/item/types";
import { convertToImageURL, getExtraValues } from "@/lib/utils";
import { routing } from "@/i18n/routing";

export async function getCurrentItem(key: string) {
    const data = await getCachedItemSmall(key).catch(() => ({ item: undefined }));
    if (data?.item && !data?.item?.citation) {
        return await getCachedItemSmall(key, true).catch(() => ({ item: undefined }));
    }
    return data;
}

function getPages(pages: string): { firstPage?: string; lastPage?: string } {
    if (!pages) return {};

    const normalizedPages = pages.replace(/[-\u2013]/g, '-');

    const pageParts = normalizedPages.split(/\s*-\s*/);
    
    return {
        firstPage: pageParts[0]?.trim() || undefined,
        lastPage: pageParts[1]?.trim() || undefined
    };
}

export async function generateMetadata(props: {
    params: Promise<{ key: string }>;
}): Promise<Metadata> {
    const params = await props.params;
    const data = await getCurrentItem(params.key);
    const status = await getCachedStatus();

    const companyName = status.companyName ?? "Evidence Library";

    if (!data || !data.item) {
        return {
            title: "404 - Not Found",
            description: "404 - Not Found",
            generator: "new-el",
        };
    }

    const item: Item = data.item;
    const extraValues = getExtraValues(item.extra ?? "");
    const attachmentExists = item.attachmentsData?.find((a: any) => 
        a.PDFCoverPageImage
    );

    const fullTextPDFs = item.fullTextPDFs ?? [];

    const institution = Array.isArray(item.institution) ? item.institution.join(", ") : item.institution;

    const pdfWithImage = item.attachmentsData?.find((a: any) => a.PDFCoverPageImage);

	return {
		title: item.title,
        description: item.abstractNote,
        generator: "new-el",
        alternates: {
            canonical: `${process.env.BASE_URL!}/lib/${item.key}`,
            languages: routing.locales.filter(locale => locale !== routing.defaultLocale).reduce((acc: { [locale: string]: string }, locale) => {
                acc[locale] = `${process.env.BASE_URL!}/${locale}/lib/${item.key}`;
                return acc;
            }, {}),
            types: {
                "application/x-research-info-systems": `${process.env.BASE_URL!}/lib/${item.key}/export/ris`,
                "application/x-bibtex": `${process.env.BASE_URL!}/lib/${item.key}/export/bibtex`,
            },
            media: {
                'image/jpeg': pdfWithImage ? convertToImageURL(pdfWithImage.PDFCoverPageImage ?? "") : null,
                'application/pdf': pdfWithImage ? `${process.env.BASE_URL!}/lib/${item.key}/download/${pdfWithImage.key}` : null
            },
        },
        other: {
            "citation_title": item.title ?? "",
            "citation_publication_date": item.date ?? "",
            "citation_date": item.date ?? "",
            "citation_year": item.year ?? "",

            "citation_author": item.creators?.filter((creator: any) => creator.creatorType === "author").map((creator: any) => 
                Object.entries(creator)
                    .filter(([key]) => key !== 'creatorType')
                    .map(([_, value]) => value)
                    .join(', ')
            ) ?? [],
            
            "citation_volume": item.volume ?? "",
            "citation_issue": item.issue ?? "",
            "citation_language": item.languageName ?? "",
            "citation_publisher": item.publisher ?? "",
            "citation_firstpage": getPages(item.pages ?? "").firstPage ?? "",
            "citation_lastpage": getPages(item.pages ?? "").lastPage ?? "",

            "citation_conference_title": item.conferenceName ?? "",
            "citation_journal_title": item.publicationTitle ?? "",
            "citation_dissertation_institution": item.university ?? "",
            "citation_technical_report_institution": institution ?? "",
            "citation_technical_report_number": item.reportNumber ?? "",

            "citation_isbn": item.ISBN ?? extraValues.get("ISBN") ?? "",
            "citation_issn": item.ISSN ?? extraValues.get("ISSN") ?? "",
            "citation_doi": item.DOI ?? extraValues.get("DOI") ?? "",

            "citation_public_url": item.url ?? "",
            "citation_pdf_url": pdfWithImage ? `${process.env.BASE_URL!}/lib/${item.key}/download/${pdfWithImage.key}` : ""
        },
        openGraph: {
            title: item.title ?? '',
            description: item.abstractNote ?? '',
            url: `${process.env.BASE_URL!}/lib/${item.key}`,
            siteName: companyName,
            images: [
                {
                    url: pdfWithImage ? convertToImageURL(pdfWithImage.PDFCoverPageImage ?? "") : '',
                    width: pdfWithImage?.PDFCoverPageWidth ?? 1200,
                    height: pdfWithImage?.PDFCoverPageHeight ?? 630,
                    alt: item.title ?? ''
                }
            ],
            locale: 'en_GB',
            type: 'article',
            authors: item.creators?.filter((creator: any) => creator.creatorType === "author").map((creator: any) => 
                Object.entries(creator)
                    .filter(([key]) => key !== 'creatorType')
                    .map(([_, value]) => value)
                    .join(', ')
            ) ?? [],
            publishedTime: item.date?.toString() ?? '',
            modifiedTime: (item.dateModified ?? item.date)?.toString() ?? '',
        },
	};
}

export default async function ServerComponent( props: {
    params: Promise<{ key: string }>;
}) {
    const params = await props.params;
    const data = await getCurrentItem(params.key);

    if (!data || data.item === undefined) {
        return notFound();
    }

    return <ItemPage data={data as ItemGetResponse} loading={false} />
}