"use client";

import { useLayoutEffect, useMemo } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { useLastFetchedData } from "@/context/Providers";
import ItemPage from "@/components/features/newlib/ItemPage";

export default function LoadingComponent({ itemKey }: { itemKey: string }) {
    const { lastFetchedData } = useLastFetchedData();

    const itemAsResponse = useMemo(() => {
        const theItem = lastFetchedData?.items?.find((item) => {
            return item.key === itemKey;
        });
        if (!theItem) return undefined;
        theItem.collectionsData = [];
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