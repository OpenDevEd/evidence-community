import ItemComponent from "@/components/pages/Item";
import { getItem } from "@/app/api/item/[key]/route";
import { db } from "@/db";
import { routing } from "@/i18n/routing";
import { getCachedItem, getCachedItemSmall, getCachedStatus } from "@/app/api/cache";
import { Item, ItemGetResponse } from "@/app/api/item/types";
import { Metadata } from "next";
import { getExtraValues } from "@/lib/utils";

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


async function getCurrentItem(key: string) {
    const data = await getCachedItemSmall(key).catch(() => ({ item: undefined }));
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
                'image/jpeg': attachmentExists?.PDFCoverPageImage ?? null,
                'application/pdf': attachmentExists?.url ?? null
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
            "citation_technical_report_institution": item.institution ?? "",
            "citation_technical_report_number": item.reportNumber ?? "",

            "citation_isbn": item.ISBN ?? extraValues.get("ISBN") ?? "",
            "citation_issn": item.ISSN ?? extraValues.get("ISSN") ?? "",
            "citation_doi": item.DOI ?? extraValues.get("DOI") ?? "",

            "citation_public_url": item.url ?? "",
            "citation_pdf_url": item.attachmentsData?.find((a: Item) => 
                a.PDFCoverPageImage
            )?.url ?? "",
        },
        openGraph: {
            title: item.title ?? '',
            description: item.abstractNote ?? '',
            url: `${process.env.BASE_URL!}/lib/${item.key}`,
            siteName: companyName,
            images: [
                {
                    url: attachmentExists?.PDFCoverPageImage ?? '',
                    width: attachmentExists?.PDFCoverPageWidth ?? 1200,
                    height: attachmentExists?.PDFCoverPageHeight ?? 630,
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

export default async function ItemPage(
    props: {
        params: Promise<{ key: string }>;
    }
) {
    const params = await props.params;
    const data = await getCurrentItem(params.key);
    
    return <ItemComponent data={data as ItemGetResponse} />;
}
