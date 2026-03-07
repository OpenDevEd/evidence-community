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
import { getCurrentItem } from "./page";
import { createPerfTrace, getApproxJsonBytes } from "@/lib/perf-log";



export default async function ServerComponent( props: {
    params: Promise<{ key: string }>;
}) {
    const params = await props.params;
    const trace = createPerfTrace("itemServerComponent", params);
    const data = await getCurrentItem(params.key);
    trace.step("item-loaded", {
        hasItem: Boolean(data?.item),
        bytes: getApproxJsonBytes(data?.item),
    });

    if (!data || !data.item) {
        trace.end({
            hasItem: false,
            outcome: "not-found",
        });
        return notFound();
    }

    trace.end({
        hasItem: true,
        bytes: getApproxJsonBytes(data.item),
        attachmentsCount: data.item.attachmentsData?.length ?? 0,
        collectionsCount: data.item.collectionsData?.length ?? 0,
        creatorsCount: data.item.creators?.length ?? 0,
    });

    return <ItemPage data={data as ItemGetResponse} loading={false} />
}
