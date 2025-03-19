"use client";

import { ItemGetResponse } from "@/app/api/item/types";
import ItemRow from "@/components/features/items/ItemRow";
import ItemControls from "@/components/features/items/ItemControls";
import { BsStars } from "react-icons/bs";
import { Button } from "@/components/nextui/Button";
import {
	Dropdown,
	DropdownItem,
	DropdownTrigger,
	DropdownMenu,
	useDisclosure,
	Spinner,
	Divider,
} from "@nextui-org/react";
import GenerativeModal from "../features/modals/GenerativeModal";
import ChatModal from "../features/modals/ChatModal";
import { useRouter } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher, fetcherPOST, isAIAllowed } from "@/lib/utils";
import Resource from "../features/items/Resource";
import { Skeleton } from "../nextui/Skeleton";
import { useMemo, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import { motion } from "framer-motion";
import { useFeatureFlagEnabled, useLastFetchedData } from "@/context/Providers";
import { AIHistory } from "@/types/ai";
import ModelSelector from "../features/ai/ModelSelector";
import { useAIFeature } from "@/hooks/useAIFeature";
import { AI_DROPDOWN_ITEMS } from "@/components/features/ai/AIDropdownItems";
import { buildHierarchy } from "@/lib/collections";
import { Collection } from "@/app/api/collections/types";
import { CollectionsRow } from "@/lib/items";
import { ItemsGetResponse } from "@/app/api/items/types";
import PageContainer from "../layout/PageContainer";
import { models } from "@/constants/ai";
import posthog from "posthog-js";
import { useSelectedModel } from "@/hooks/useSelectedModel";

function randomUUID() {
	return (
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15)
	);
}

function AiButton({ data }: { data: ItemGetResponse | undefined }) {
	const { selectedModel, setSelectedModel } = useSelectedModel();
	const body = {
		prompt: data?.item?.key,
		modelIndex: selectedModel,
		distinctId: posthog.get_distinct_id(),
	};
	const locale = useLocale();
	const { data: questions } = useSWR(
		[
			`/ai/questions`,
			body,
			{
				"Accept-Language": locale,
			},
		],
		fetcherPOST,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
		}
	);
	const id = useRef(randomUUID());
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");

	const { isOpen: isChatOpen, onOpenChange: onChatOpenChange } =
		useDisclosure();
	const { isOpen: isChangeOpen, onOpenChange: onChangeOpenChange } =
		useDisclosure();

	const [histories, setHistories] = useLocalStorage<
		Record<string, AIHistory[]>
	>(`ai-history`, {});

	const updateHistory = (prompt: string, completion: string, id: string) => {
		setHistories((prev) => {
			const newHistory = prev[prompt] || [];
			const obj = newHistory.find((item) => item.id === id);
			if (obj) {
				obj.content = completion;
			} else {
				newHistory.unshift({
					id,
					content: completion,
					date: new Date(),
					title: data!.item!.title!,
					key: data!.item!.key!,
					modelIndex: selectedModel,
				});
			}
			return { ...prev, [prompt]: newHistory };
		});
	};

	const summaryFeature = useAIFeature(
		"summarize",
		id.current,
		updateHistory,
		data,
		selectedModel
	);
	const explainFeature = useAIFeature(
		"explain",
		id.current,
		updateHistory,
		data,
		selectedModel
	);

	const handleModelChange = (modelIndex: number) => {
		setSelectedModel(modelIndex);
		[summaryFeature, explainFeature].forEach((feature) => {
			feature.setCompletion("");
		});
		id.current = crypto.randomUUID();
	};

	return (
		<motion.div
			className="fixed bottom-0 right-0 z-40 print:hidden"
			initial={{ opacity: 0, x: 100 }}
			animate={{ opacity: 1, x: 0 }}
		>
			<div className="flex items-center justify-center p-4">
				<ModelSelector
					isOpen={isChangeOpen}
					onOpenChange={onChangeOpenChange}
					selectedModel={selectedModel}
					onModelChange={handleModelChange}
				/>
				<ChatModal
					isOpen={isChatOpen}
					onOpenChange={onChatOpenChange}
					data={data}
					modelIndex={selectedModel}
					questions={questions}
				/>
				{[summaryFeature, explainFeature].map((feature) => (
					<GenerativeModal
						key={feature.key}
						isOpen={feature.isOpen}
						onOpenChange={feature.onOpenChange}
						content={feature.response}
						title={t(feature.key)}
						error={feature.error}
						history={histories[feature.key] || []}
						setHistory={(history) =>
							setHistories((prev) => ({
								...prev,
								[feature.key]: history,
							}))
						}
						id={id.current}
					/>
				))}
				<Dropdown
					classNames={{
						content: "bg-white dark:bg-secondary",
					}}
				>
					<DropdownTrigger>
						<Button
							isIconOnly
							aria-label={tUI("aiMenuAriaLabel")}
							className="!p-0 rounded-full bg-gradient-to-r from-accent-400 to-accent-700 !text-white !outline-0 border-0 shadow-[0_0_12px_4px_rgba(255,255,255,0.1)] shadow-accent"
						>
							<BsStars />
						</Button>
					</DropdownTrigger>
					<DropdownMenu
						items={AI_DROPDOWN_ITEMS(
							t,
							selectedModel,
							onChangeOpenChange,
							summaryFeature,
							explainFeature,
							onChatOpenChange
						)}
						itemClasses={{
							base: "data-[hover]:bg-accent dark:data-[hover]:bg-accent data-[hover]:text-white dark:data-[hover]:text-white",
						}}
					>
						{(item) => (
							<DropdownItem
								key={item.key}
								description={item.description}
								onPress={item.onPress}
								startContent={item.startContent}
								className="gap-4"
							>
								{item.label}
							</DropdownItem>
						)}
					</DropdownMenu>
				</Dropdown>
			</div>
		</motion.div>
	);
}

const skippedRows = ["relations", "citation"];

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
	const router = useRouter();
	const t = useTranslations("ui");
	const isAIEnabled = useFeatureFlagEnabled("ai-features");
	const isRelatedItemsEnabled =
		useFeatureFlagEnabled("related-resources") &&
		process.env.NEXT_PUBLIC_DISABLE_EMBEDDINGS !== "true";
	const isCollectionsEnabled = useFeatureFlagEnabled("collections");
	const { lastFetchedData, setLastFetchedData } = useLastFetchedData();
	const { data: embeddings } = useSWR(
		isRelatedItemsEnabled && data?.item && !loading
			? `/ai/embeddings/${data?.item?.key}`
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
	const aiAllowed = isAIAllowed(data?.item);

	const hierarchy = useMemo(() => {
		if (!data?.item?.collectionsData) return null;
		return buildHierarchy(data.item.collectionsData);
	}, [data?.item?.collectionsData]);

	return (
		<PageContainer id="main-content" className="flex flex-col gap-4">
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
										.toSorted((a, b) => a.localeCompare(b))
										.map((row: string) => (
											<ItemRow
												item={data.item!}
												key={row}
												row={row}
												router={router}
												loading={loading}
											/>
										))}
								<Divider />
								<ItemRow
									item={data.item!}
									key="citation"
									row="citation"
									router={router}
									loading={loading}
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
											key={collection.id}
											router={router}
											customRowName={collection.title}
											value={
												<CollectionsRow
													value={collection.children!}
												/>
											}
											loading={loading}
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
			{isAIEnabled && data?.item && !loading && aiAllowed && (
				<AiButton data={data} />
			)}
			<div className="w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] print:hidden  p-4 lg:p-10 gap-10 flex flex-col">
				<div className="gap-8">
					{isRelatedItemsEnabled && data?.item && (
						<RowContainer title={t("recommendedItems")}>
							<Skeleton
								isLoaded={!!embeddings}
								className="data-[loaded]:min-h-0 min-h-screen rounded-2xl w-full"
							>
								<ul className="grid grid-cols-1 gap-4">
									{embeddings?.hits.map((hit: any) => (
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
					)}
				</div>
				{(data?.item && data.item.relations) ? <div className="flex flex-col gap-10">
					
						<ItemRow
							item={data.item!}
							key="relations"
							row="relations"
							router={router}
							loading={loading}
							tooltip="Only items available in the current database are displayed. Some related resources are only available externally."
						/>
					
				</div> : null}
			</div>
		</PageContainer>
	);
}
