"use client";

import { ItemsGetResponse } from "@/app/api/items/types";
import { useLocalStorage } from "usehooks-ts";
import ItemComponent from "@/components/pages/Item";
import { useLayoutEffect, useMemo } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { useLastFetchedData } from "@/context/Providers";

export default function LoadingComponent({ itemKey }: { itemKey: string }) {
    const { lastFetchedData } = useLastFetchedData();

    const itemAsResponse = useMemo(() => {
        console.log("lastFetchedData", lastFetchedData);
        const theItem = lastFetchedData?.items?.find((item) => {
            console.log("comparing", item.key, itemKey);
            return item.key === itemKey;
        });
        console.log(lastFetchedData?.items);
        if (!theItem) return undefined;
        return {
            item: theItem,
        } as ItemGetResponse;
    }, [lastFetchedData, itemKey]);

    useLayoutEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    console.log("itemAsResponse", itemAsResponse);

    return <ItemComponent loading={true} data={itemAsResponse} />
}