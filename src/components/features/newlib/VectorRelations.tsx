'use client';

import { Item } from "@/app/api/item/types";
import useSWR from "swr";
import { useFeatureFlagEnabled, useLastFetchedData } from "@/context/Providers";
import { fetcher } from "@/lib/utils";
import { ItemsGetResponse } from "@/app/api/items/types";
import Resource from "../items/Resource";

export default function VectorRelations({ item }: { item: Item | undefined }) {
	const { lastFetchedData, setLastFetchedData } = useLastFetchedData();
	const isRelatedItemsEnabled = useFeatureFlagEnabled("related-resources");
	const { data: embeddings, isLoading } = useSWR(
		isRelatedItemsEnabled && item?.key
			? `/ai/embeddings/${item?.key}`
			: null,
		fetcher,
		{
			onSuccess: (data) => {
				if (data) {
					setLastFetchedData({
						items: data.hits,
					} as ItemsGetResponse);
				}
			},
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
		}
	);

	if (!isRelatedItemsEnabled) return null;

	return (
		<div id="vector-relations" className="flex flex-col md:grid grid-cols-2 gap-4">
			{isLoading ? Array.from({ length: 3 }).map((_, index) => (
				<Resource
					key={index}
					itemData={undefined}
					abstract={false}
					isLoading={true}
				/>
			)) : embeddings?.hits.map((hit: any, index: number) => (
				<Resource
					key={index}
					itemData={hit}
					abstract={false}
					isLoading={false}
				/>
			))}
		</div>
	);
}
