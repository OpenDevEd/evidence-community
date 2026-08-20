"use client";

import type { Item } from "@/app/api/item/types";
import useSWR from "swr";
import { useLastFetchedData } from "@/context/Providers";
import { fetcher } from "@/lib/utils";
import type { ItemsGetResponse } from "@/app/api/items/types";
import Resource from "../items/Resource";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";

export default function VectorRelations({
	item,
	loading,
}: {
	item: Item | undefined;
	loading: boolean;
}) {
	const { setLastFetchedData } = useLastFetchedData();
	const isRelatedItemsEnabled = useLibraryFeature("relatedResources");
	const { data: embeddings, error } = useSWR(
		isRelatedItemsEnabled && item?.key && !loading
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
			shouldRetryOnError: false,
		},
	);

	if (!isRelatedItemsEnabled) return null;

	// Waiting for the item or for the recommendations: show placeholder cards
	// in the final layout instead of letting the block appear later.
	const waiting = loading || (!embeddings && !error);
	if (waiting) {
		return (
			<div
				id="vector-relations"
				aria-busy="true"
				className="flex flex-col md:grid grid-cols-2 gap-4"
			>
				{Array.from({ length: 4 }).map((_, index) => (
					<Resource
						key={`skeleton-${index}`}
						as="div"
						itemData={undefined}
						abstract={false}
						isLoading={true}
						hideUnapi={true}
					/>
				))}
			</div>
		);
	}

	// Unavailable or empty: nothing to recommend, so the block stays out.
	if (!embeddings?.hits?.length) return null;

	return (
		<div
			id="vector-relations"
			aria-busy="false"
			className="flex flex-col md:grid grid-cols-2 gap-4"
		>
			{embeddings.hits.map((hit: any, index: number) => (
				<Resource
					key={index}
					itemData={hit}
					abstract={false}
					isLoading={false}
					hideUnapi={true}
				/>
			))}
		</div>
	);
}
