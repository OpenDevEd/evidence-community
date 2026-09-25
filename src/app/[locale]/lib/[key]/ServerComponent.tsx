import { ItemGetResponse } from "@/app/api/item/types";
import ItemPage from "@/components/features/newlib/ItemPage";
import { RefreshPrefetchedItem } from "@/components/features/newlib/RefreshPrefetchedItem";
import { notFound } from "next/navigation";
import { getCachedItemSmall } from "@/app/api/cache";
import { Metadata } from "next";
import { Item } from "@/app/api/item/types";
import { convertToImageURL, getExtraValues } from "@/lib/utils";
import { routing } from "@/i18n/routing";
import { getCurrentItem } from "./page";



export default async function ServerComponent( props: {
    params: Promise<{ key: string }>;
}) {
    const params = await props.params;
    const data = await getCurrentItem(params.key);

    if (!data || !data.item) {
        return notFound();
    }

    return (
        <>
            <RefreshPrefetchedItem itemKey={params.key} />
            <ItemPage data={data as ItemGetResponse} loading={false} />
        </>
    );
}
