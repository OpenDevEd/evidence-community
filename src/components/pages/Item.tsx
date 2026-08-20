"use client";

import { ItemGetResponse } from "@/app/api/item/types";
import ItemRow from "@/components/features/items/ItemRow";
import ItemControls from "@/components/features/items/ItemControls";
import {
	Spinner,
	Divider,
} from "@nextui-org/react";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher, getExtraValues } from "@/lib/utils";
import Resource from "../features/items/Resource";
import { Skeleton } from "../nextui/Skeleton";
import { useFeatureFlagEnabled, useLastFetchedData } from "@/context/Providers";
import { buildHierarchy } from "@/lib/collections";
import { Collection } from "@/app/api/collections/types";
import { CollectionsRow } from "@/lib/items";
import { ItemsGetResponse } from "@/app/api/items/types";
import PageContainer from "../layout/PageContainer";
import { useQueryState } from "nuqs";
import { getSafeReferrer } from "@/constants/misc";
import AiWrapper from "@/components/features/newlib/AiWrapper";

const skippedRows = ["relations", "citation", "DOI"];

function RowContainer({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex lg:flex-row flex-col lg:gap-4">
			<h3 className="text-xl font-medium text-black/60 dark:text-white/60 lg:w-64 w-full shrink-0 rounded">
				{title}
			</h3>
			<div className="w-full">{children}</div>
		</div>
	);
}

export default function Item({
	data,
	loading,
}: {
	data: ItemGetResponse | undefined;
	loading: boolean;
}) {
	const [referrerState] = useQueryState("referrer");
	const referrer = getSafeReferrer(referrerState);
	const router = useRouter();
	const t = useTranslations("ui");
	const isRelatedItemsEnabled = useFeatureFlagEnabled("related-resources");
	const isCollectionsEnabled = useFeatureFlagEnabled("collections");
	const { setLastFetchedData } = useLastFetchedData();
	const { data: similarResources } = useSWR(
		isRelatedItemsEnabled && data?.item && !loading
			? `/similar/${data?.item?.key}`
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
	const hierarchy = data?.item?.collectionsData
		? buildHierarchy(data.item.collectionsData)
		: null;

	return (
		<PageContainer id="main-content" className="flex flex-col gap-4">
			{data?.item && <abbr className="unapi-id" title={data?.item?.key}></abbr>}
			<div className="w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] ">
				{data?.item && (
					<ItemControls
						itemData={data?.item}
						router={router}
						loading={loading}
					/>
				)}
				<div className="flex flex-col gap-8 p-4 lg:p-10">
					{data?.item ? (
						<>
							<h1 className="text-4xl text-black/80 dark:text-white/80 font-medium">
								{data?.item.title}
							</h1>
							<div className="flex flex-col gap-8">
								{data?.item &&
									Object.keys(data.item)
										.filter(
											(key) => !skippedRows.includes(key)
										)
										.sort((a, b) => a.localeCompare(b))
										.map((row: string) => (
											<ItemRow
												item={data.item!}
												key={row}
												row={row}
												router={router}
												loading={loading}
												pathname={referrer}
											/>
										))}
								<Divider />
								<ItemRow
									item={data.item!}
									key="citation"
									row="citation"
									router={router}
									loading={loading}
									pathname={referrer}
								/>
								<ItemRow
									item={data.item!}
									key="DOI"
									row="DOI"
									router={router}
									loading={loading}
									pathname={referrer}
									value={
										data.item!.DOI ||
										getExtraValues(
											data.item!.extra || ""
										).get("DOI")
									}
								/>
							</div>
							{isCollectionsEnabled &&
								hierarchy &&
								hierarchy
									.filter(
										(collection: Collection) =>
											collection.children?.length &&
											collection.children?.length > 0
									)
									.map((collection: Collection) => (
										<ItemRow
											item={data.item!}
											key={collection.key}
											router={router}
											customRowName={collection.title}
											value={
												<CollectionsRow
													value={collection.children!}
													pathname={referrer}
												/>
											}
											loading={loading}
											pathname={referrer}
										/>
									))}
						</>
					) : loading ? (
						<div className="flex items-center justify-center min-h-screen">
							<Spinner />
						</div>
					) : (
						<div className="text-center text-2xl text-black/80 dark:text-white/80 font-medium min-h-screen flex items-center justify-center">
							{t("itemNotFound")}
						</div>
					)}
				</div>
			</div>
			{data?.item && !loading && <AiWrapper data={data} />}
			<div className="w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] print:hidden p-4 lg:p-10 gap-10 flex flex-col empty:hidden">
				{isRelatedItemsEnabled && data?.item && (
					<div className="gap-8">
						<RowContainer title={t("recommendedItems")}>
							<Skeleton
								isLoaded={!!similarResources}
								className="data-[loaded]:min-h-0 min-h-screen rounded-2xl w-full"
							>
								<ul className="grid grid-cols-1 gap-4">
									{similarResources?.hits.map((hit: any) => (
										<Resource
											key={hit.id}
											itemData={hit}
											abstract={false}
											isLoading={false}
										/>
									))}
								</ul>
							</Skeleton>
						</RowContainer>
					</div>
				)}
				{data?.item && data.item.relations ? (
					<div className="flex flex-col gap-10">
						<ItemRow
							item={data.item!}
							key="relations"
							row="relations"
							router={router}
							loading={loading}
							tooltip="Only items available in the current database are displayed. Some related resources are only available externally."
							pathname={referrer}
						/>
					</div>
				) : null}
			</div>
		</PageContainer>
	);
}
