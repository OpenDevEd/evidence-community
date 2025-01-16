import ItemComponent from "@/components/pages/Item";
import { getItem } from "@/app/api/item/[key]/route";
import { db } from "@/db";
import { routing } from "@/i18n/routing";
import { getCachedItem } from "@/app/api/cache";
import { ItemGetResponse } from "@/app/api/item/types";
import { Metadata } from "next";

// export async function generateStaticParams() {
// 	if (process.env.SHOULD_GENERATE_STATIC_PAGES === "true") {
// 		const documents = await db.query.item.findMany({
// 			columns: {
// 				key: true,
// 				parentItem: true,
// 			},
// 		});

//         console.log("documents", documents);

// 		return documents.flatMap((item) => 
// 			routing.locales.map((locale) => ({
// 				locale,
// 				key: item.parentItem ? item.parentItem : item.key,
// 			}))
// 		);
// 	}
// }


async function getCurrentItem(key: string) {
    const data = await getCachedItem(key).catch(() => ({ item: undefined }));
    return data;
}

export async function generateMetadata(props: {
    params: Promise<{ key: string }>;
}): Promise<Metadata> {
    const params = await props.params;
    const data = await getCurrentItem(params.key);
    const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:\w-]+/gi;
    const DOIs = Array.from(new Set([data?.item?.DOI, ...(Array.from(data?.item?.extra?.matchAll(DOI_REGEX) || []).map(m => m[0]))].filter(Boolean).map(doi => doi?.trim())))
    const attachmentExists = data?.item?.attachmentsData?.find((a: any) => 
        a.PDFCoverPageImage
    );


	return {
		title: data?.item?.title,
        description: data?.item?.abstractNote,
        alternates: {
            canonical: `${process.env.BASE_URL!}/lib/${data?.item?.key}`,
            languages: routing.locales.filter(locale => locale !== routing.defaultLocale).reduce((acc: { [locale: string]: string }, locale) => {
                acc[locale] = `${process.env.BASE_URL!}/${locale}/lib/${data?.item?.key}`;
                return acc;
            }, {}),
            types: {
                "application/x-research-info-systems": `${process.env.BASE_URL!}/lib/${data?.item?.key}/export/ris`,
                "application/x-bibtex": `${process.env.BASE_URL!}/lib/${data?.item?.key}/export/bibtex`,
            },
            media: {
                'image/jpeg': attachmentExists?.PDFCoverPageImage ?? null,
                'application/pdf': attachmentExists?.url ?? null
            }
        },
        other: {
            "citation_title": data?.item?.title ?? "",
            "citation_date": data?.item?.date ?? "",
            "citation_publication_date": data?.item?.date ?? "",
            "citation_cover_date": data?.item?.date ?? "",
            "citation_online_date": data?.item?.date ?? "",

            "citation_journal_title": data?.item?.publicationTitle ?? "",
            "citation_journal_abbrev": data?.item?.journalAbbreviation ?? "",
            "citation_book_title": data?.item?.bookTitle ?? "",
            "citation_series_title": data?.item?.series ?? "",
            "citation_volume": data?.item?.volume ?? "",
            "citation_issue": data?.item?.issue ?? "",
            "citation_firstpage": data?.item?.pages?.split('-')[0] ?? "",
            "citation_lastpage": data?.item?.pages?.split('-')[1] ?? "",

            "citation_doi": DOIs as any,
            "citation_isbn": data?.item?.ISBN ?? "",
            "citation_issn": data?.item?.ISSN ?? "",

            "citation_public_url": data?.item?.url ?? "",
            "citation_pdf_url": data?.item?.attachmentsData?.filter( (a: any) => {
                return a.contentType === 'application/pdf'
            })?.map((a: any) => a.url) ?? [],

            "citation_publisher": data?.item?.publisher ?? "",
            "citation_dissertation_institution": data?.item?.university ?? "",
            "citation_technical_report_institution": data?.item?.institution ?? "",
            "citation_technical_report_number": data?.item?.reportNumber ?? "",

            "citation_language": data?.item?.languageName ?? "",
            "citation_keywords": data?.item?.tags?.join('; ') ?? "",
            "citation_abstract": data?.item?.abstractNote ?? "",
            "citation_conference_title": data?.item?.conferenceName ?? "",

            ...(data?.item?.creators?.reduce((acc: any, creator: any) => {
                const citationKey = `citation_${creator.creatorType.toLowerCase()}`;
                const creatorName = Object.entries(creator)
                    .filter(([key]) => key !== 'creatorType')
                    .map(([_, value]) => value)
                    .join(', ');
                
                if (acc[citationKey]) {
                    acc[citationKey] = Array.isArray(acc[citationKey]) 
                        ? [...acc[citationKey], creatorName]
                        : [acc[citationKey], creatorName];
                } else {
                    acc[citationKey] = creatorName;
                }
                return acc;
            }, {}) ?? {})
        },
        openGraph: {
            title: data?.item?.title ?? '',
            description: data?.item?.abstractNote ?? '',
            url: `${process.env.BASE_URL!}/lib/${data?.item?.key}`,
            siteName: 'OpenDeved',
            images: [
                {
                    url: attachmentExists?.PDFCoverPageImage ?? '',
                    width: attachmentExists?.PDFCoverPageWidth ?? 1200,
                    height: attachmentExists?.PDFCoverPageHeight ?? 630,
                    alt: data?.item?.title ?? ''
                }
            ],
            locale: 'en_US',
            type: 'article',
            authors: data?.item?.creators?.map((creator: any) => 
                Object.entries(creator)
                    .filter(([key]) => key !== 'creatorType')
                    .map(([_, value]) => value)
                    .join(', ')
            ) ?? [],
            publishedTime: data?.item?.date?.toString() ?? '',
            modifiedTime: (data?.item?.dateModified ?? data?.item?.date)?.toString() ?? '',
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
