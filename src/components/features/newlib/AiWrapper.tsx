"use client";

import { ItemGetResponse } from "@/app/api/item/types";
import { BsStars } from "react-icons/bs";
import { Button } from "@/components/nextui/Button";
import {
	Dropdown,
	DropdownItem,
	DropdownTrigger,
	DropdownMenu,
	useDisclosure,
} from "@nextui-org/react";
import GenerativeModal from "@/components/features/modals/GenerativeModal";
import ChatModal from "@/components/features/modals/ChatModal";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher, fetcherPOST, isAIAllowed } from "@/lib/utils";
import { useRef, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { motion } from "framer-motion";
import { AIHistory } from "@/types/ai";
import ModelSelector from "@/components/features/ai/ModelSelector";
import { useAIFeature } from "@/hooks/useAIFeature";
import { AI_DROPDOWN_ITEMS } from "@/components/features/ai/AIDropdownItems";
import posthog from "posthog-js";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { twMerge } from "tailwind-merge";

function randomUUID() {
	return (
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15)
	);
}

function AiButton({
	data,
	isEmbedded,
	setIsEmbedded,
	variant,
}: {
	data: ItemGetResponse | undefined;
	isEmbedded: boolean | null;
	setIsEmbedded: React.Dispatch<React.SetStateAction<boolean | null>>;
	variant?: "default" | "inline";
}) {
	const { selectedModel, setSelectedModel } = useSelectedModel();
	const body = {
		prompt: data?.item?.key,
		modelIndex: selectedModel,
		distinctId: posthog.get_distinct_id(),
	};
	const locale = useLocale();
	
	const { isOpen: isChatOpen, onOpenChange: onChatOpenChange } =
		useDisclosure();
	const { isOpen: isChangeOpen, onOpenChange: onChangeOpenChange } =
		useDisclosure();
		
	const { data: questions } = useSWR(
		isChatOpen ?[
			`/ai/questions`,
			body,
			{
				"Accept-Language": locale,
			},
		] : null,
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
			className={twMerge("", variant === "default" && "fixed bottom-0 right-0 z-40 print:hidden")}
			initial={{ opacity: 0, x: 100 }}
			animate={{ opacity: 1, x: 0 }}
		>
			<div className={twMerge(
				"flex items-center justify-center",
				variant === "default" && " p-4")}>
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
					isEmbedded={isEmbedded}
					setIsEmbedded={setIsEmbedded}
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
							isIconOnly={variant === "default"}
							aria-label={tUI("aiMenuAriaLabel")}
							className={twMerge(
								// "bg-gradient-to-r from-accent-400 to-accent-700 !text-white !outline-0 border-0 shadow-[0_0_12px_4px_rgba(255,255,255,0.1)] shadow-accent",
								variant === "default" && "!p-0 rounded-full "
							)}
							size={variant === "inline" ? "sm" : "lg"}
						>
							<BsStars />
							{variant === "inline" && t("askAI")}
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

export default function AiWrapper({
	data,
	variant = "default",
}: {
	data: ItemGetResponse | undefined;
	variant?: "default" | "inline";
}) {
	const [isEmbedded, setIsEmbedded] = useState<boolean | null>(null);

	const { data: embedded } = useSWR(
		(data?.item && process.env.NEXT_PUBLIC_DISABLE_EMBEDDINGS !== "true") ? `/item/${data?.item?.key}/embedded` : null,
		fetcher,
		{
			onSuccess: (data) => {
				setIsEmbedded(data);
			},
		}
	);

	const aiAllowed = isAIAllowed(data?.item);
	const isAIEnabled = useFeatureFlagEnabled("ai-features");

	if (!isAIEnabled || !aiAllowed) return null;

	return (
		<AiButton
			data={data}
			isEmbedded={isEmbedded}
			setIsEmbedded={setIsEmbedded}
			variant={variant}
		/>
	);
}
