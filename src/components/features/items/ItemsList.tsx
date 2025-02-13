"use client";

import { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useFormatter } from "next-intl";
import { useItemsList } from "@/hooks/useItemsList";
import { ResourcesView } from "../resources/ResourcesView";

function NumberWrapper({ children }: { children: ReactNode }) {
	return (
		<span className="text-xl font-medium text-black/80 dark:text-white/80">
			{children}
		</span>
	);
}

function CollectionWrapper({ children }: { children: ReactNode }) {
	return (
		<span className="text-sm text-black/60 dark:text-white/60">
			{children}
		</span>
	);
}

export default function ItemsList({
	userData,
	extraFilters,
	props,
}: {
	userData?: any;
	extraFilters?: ReactNode;
	props: ReturnType<typeof useItemsList>;
}) {
	const t = useTranslations("ui");
	const formatter = useFormatter();

	return (
		<ResourcesView
			sort={props.queryParams.sort}
			search={props.queryParams.search}
			scope={props.queryParams.scope}
			handleSearchChange={props.handleSearchChange}
			handleScopeChange={props.handleScopeChange}
			handleSortChange={props.handleSortChange}
			itemsData={props.itemsData}
			itemsError={props.itemsError}
			isItemsLoading={props.isItemsLoading}
			range={props.queryParams.range}
			handleRangeChange={props.handleRangeChange}
			pageNumber={props.queryParams.page}
			handlePageChange={props.handlePageChange}
			searchParams={props.searchParams}
			isItemsFetching={props.isItemsFetching}
			revalidateResults={props.revalidateResults}
			extraFilters={extraFilters}
			queryParams={props.queryParams}
			{...(!userData ? {
				collectionsData: props.collectionsData,
				hierarchy: props.hierarchy,
				handleCheckboxChange: props.handleCheckboxChange,
				selectedCollections: props.selectedCollections,
			} : {
				params: {
					id: userData.id,
				},
				countLabel: (<div>
					{props.queryParams.collectionId
						? t.rich("itemsInCollection", {
								count: formatter.number(
									props.itemsData?.totalItems || 0
								),
								number: (chunks) => (
									<NumberWrapper>{chunks}</NumberWrapper>
								),
								collection: userData.collections.find(
									(collection: any) =>
										collection.id === props.queryParams.collectionId
								)?.name,
								collections: (chunks) => (
									<CollectionWrapper>
										{chunks}
									</CollectionWrapper>
								),
						  })
						: t.rich("likedItemsCount", {
								count: formatter.number(
									props.itemsData?.totalItems || 0
								),
								number: (chunks) => (
									<NumberWrapper>{chunks}</NumberWrapper>
								),
						  })}
				</div>)
			})}
		/>
	);
}