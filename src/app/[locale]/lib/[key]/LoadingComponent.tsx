"use client";

import { useLayoutEffect, useMemo } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { useLastFetchedData } from "@/context/Providers";
import ItemPage from "@/components/features/newlib/ItemPage";
import { useParams } from "next/navigation";

export default function LoadingComponent({
	itemKey,
}: {
	itemKey?: string;
}) {
	const { lastFetchedData } = useLastFetchedData();
	const params = useParams<{ key?: string | string[] }>();
	const resolvedItemKey = itemKey ?? (
		Array.isArray(params?.key) ? params.key[0] : params?.key
	);

	const itemAsResponse = useMemo(() => {
		if (!resolvedItemKey) return undefined;
		const theItem = lastFetchedData?.items?.find((item) => {
			return item.key === resolvedItemKey;
		});
		if (!theItem) return undefined;
		theItem.citation = theItem.citation ?? "<div>Loading...</div>";
		return {
			item: theItem,
		} as ItemGetResponse;
	}, [lastFetchedData, resolvedItemKey]);

	useLayoutEffect(() => {
		window.scrollTo(0, 0);
	}, []);

	return <ItemPage data={itemAsResponse as ItemGetResponse} loading={true} />;
}
