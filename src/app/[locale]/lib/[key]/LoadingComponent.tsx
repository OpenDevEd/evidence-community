"use client";

import { Suspense, useLayoutEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { ItemGetResponse } from "@/app/api/item/types";
import { useLastFetchedData } from "@/context/Providers";
import ItemPage from "@/components/features/newlib/ItemPage";

/**
 * The item page while its record loads: the copy of the record the list the reader came from holds, else placeholders.
 * The key comes from the address, which a prerender does not know, so there the placeholders stand in.
 */
export default function LoadingComponent() {
    return (
        <Suspense fallback={<ItemPage data={undefined as unknown as ItemGetResponse} loading={true} />}>
            <ListCopy />
        </Suspense>
    );
}

function ListCopy() {
    const { key: itemKey } = useParams<{ key: string }>();
    const { lastFetchedData } = useLastFetchedData();

    const itemAsResponse = useMemo(() => {
        const theItem = lastFetchedData?.items?.find((item) => {
            return item.key === itemKey;
        });
        if (!theItem) return undefined;
        theItem.citation = theItem.citation ?? "<div>Loading...</div>";
        return {
            item: theItem,
        } as ItemGetResponse;
    }, [lastFetchedData, itemKey]);

    useLayoutEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return <ItemPage data={itemAsResponse as ItemGetResponse} loading={true} />
}
