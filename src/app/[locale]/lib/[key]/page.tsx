import ItemComponent from "@/components/pages/Item";
import { getItem } from "@/app/api/item/[key]/route";
import { db } from "@/db";
import { routing } from "@/i18n/routing";
import { getCachedItem, getCachedItemSmall, getCachedStatus } from "@/app/api/cache";
import { Item, ItemGetResponse } from "@/app/api/item/types";
import { Metadata } from "next";
import { convertToImageURL, getExtraValues } from "@/lib/utils";
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

export default async function ItemPage(
    props: {
        params: Promise<{ key: string }>;
    }
) {
    const params = await props.params;
    return <Suspense fallback={<LoadingComponent itemKey={params.key} />}>
        <ServerComponent params={props.params} />
    </Suspense>
}