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
} from "@nextui-org/react";
import GenerativeModal from "../features/modals/GenerativeModal";
import ChatModal from "../features/modals/ChatModal";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import Resource from "../features/items/Resource";
import { Skeleton } from "../nextui/Skeleton";
import { useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import { motion } from "framer-motion";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { AIHistory } from "@/types/ai";
import ModelSelector from "../features/ai/ModelSelector";
import { useAIFeature } from "@/hooks/useAIFeature";
import { AI_DROPDOWN_ITEMS } from "@/components/features/ai/AIDropdownItems";

function AiButton({ data }: { data: ItemGetResponse | undefined }) {
	const t = useTranslations("ai");

	const [selectedModel, setSelectedModel] = useLocalStorage("ai-model", 0);
	const id = useRef(crypto.randomUUID());

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

	const summaryFeature = useAIFeature("summarize", id.current, updateHistory, data, selectedModel);
	const explainFeature = useAIFeature("explain", id.current, updateHistory, data, selectedModel);

	const handleModelChange = (modelIndex: number) => {
		setSelectedModel(modelIndex);
		[summaryFeature, explainFeature].forEach((feature) => {
			feature.setCompletion("");
		});
		id.current = crypto.randomUUID();
	};

	return (
		<motion.div
			className="fixed bottom-0 right-0 z-40"
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
							onChatOpenChange,
						)}
						itemClasses={{
							base: "data-[hover]:bg-accent dark:data-[hover]:bg-accent data-[hover]:text-white dark:data-[hover]:text-white",
						}}
					>
						{(item) => (
							<DropdownItem
								key={item.key}
								description={item.description}
								onClick={item.onClick}
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

function formatItemToOriginalFormat(item: NonNullable<ItemGetResponse['item']>) {
	return {
		...item,
		language: item.languageName,
	};
}

export default function Item({ data }: { data: ItemGetResponse | undefined }) {
	const router = useRouter();
	const t = useTranslations("ui");
	const isAIEnabled = useFeatureFlagEnabled("ai-features");
	const isRelatedItemsEnabled = useFeatureFlagEnabled("related-resources");
	const { data: embeddings } = useSWR(
		isRelatedItemsEnabled ? `/ai/embeddings/${data?.item?.key}` : null,
		fetcher
	);

	return (
		<main className="w-full max-w-[96rem] px-4 xl:px-14 flex flex-col gap-4">
			<div className="w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] ">
				<ItemControls itemData={data?.item} router={router} />
				<div className="flex flex-col gap-8 p-4 xl:p-10">
					{data?.item ? (
						<>
							<h1 className="text-4xl text-black/80 dark:text-white/80 font-medium">
								{data?.item.title}
							</h1>
							<div className="flex flex-col gap-8">
								{data?.item &&
									Object.keys(data.item).map(
										(row: string) => (
											<ItemRow
												item={data.item!}
												key={row}
												row={row}
												router={router}
											/>
										)
									)}
							</div>
						</>
					) : (
						<div className="text-center text-2xl text-black/80 dark:text-white/80 font-medium min-h-screen flex items-center justify-center">
							{t("itemNotFound")}
						</div>
					)}
				</div>
			</div>
			{isAIEnabled && data && <AiButton data={data} />}
			{isRelatedItemsEnabled && (
				<div className="w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] ">
					<div className="flex xl:flex-row flex-col">
						<div className="text-xl font-medium text-black/60 dark:text-white/60 xl:w-64 w-full shrink-0 rounded xl:p-10 p-4 pb-0">
							{t("relatedItems")}
						</div>
						<div className="w-full">
							<Skeleton
								isLoaded={!!embeddings}
								className="data-[loaded]:min-h-0 min-h-screen rounded-2xl rounded-l-none p-4 w-full"
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
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
