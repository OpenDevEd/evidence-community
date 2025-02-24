"use client";

import ItemComponent from "@/components/pages/Item";
import { useLayoutEffect, useMemo } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { useLastFetchedData } from "@/context/Providers";

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

    return <ItemComponent loading={true} data={itemAsResponse} />
}