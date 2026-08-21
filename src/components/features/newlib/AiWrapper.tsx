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
import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { motion } from "framer-motion";
import { AIHistory } from "@/types/ai";
import ModelSelector from "@/components/features/ai/ModelSelector";
import { useAIFeature } from "@/hooks/useAIFeature";
import { AI_DROPDOWN_ITEMS } from "@/components/features/ai/AIDropdownItems";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { twMerge } from "tailwind-merge";
import type { AIProviderId } from "@/lib/ai-provider-factory";
import { getAnalyticsDistinctId } from "@/lib/analytics";

function randomUUID() {
	return (
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15)
	);
}

function AiButton({
	data,
	variant,
}: {
	data: ItemGetResponse | undefined;
	variant?: "default" | "inline";
}) {
	const {
		selectedProviderId,
		setSelectedProvider,
	} = useSelectedModel();
	const body = {
		prompt: data?.item?.key,
		provider: selectedProviderId,
		distinctId: getAnalyticsDistinctId(),
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
	const [id, setId] = useState(randomUUID);
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");

	const [histories, setHistories] = useLocalStorage<
		Record<string, AIHistory[]>
	>(`ai-history-v2`, {});

	const updateHistory = (prompt: string, completion: string, id: string) => {
		if (!selectedProviderId) return;
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
					provider: selectedProviderId,
				});
			}
			return { ...prev, [prompt]: newHistory };
		});
	};

	const summaryFeature = useAIFeature(
		"summarize",
		id,
		updateHistory,
		data,
		selectedProviderId
	);
	const explainFeature = useAIFeature(
		"explain",
		id,
		updateHistory,
		data,
		selectedProviderId
	);

	const handleProviderChange = (provider: AIProviderId) => {
		setSelectedProvider(provider);
		[summaryFeature, explainFeature].forEach((feature) => {
			feature.setCompletion("");
		});
		setId(crypto.randomUUID());
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
					selectedProvider={selectedProviderId}
					onProviderChange={handleProviderChange}
				/>
				<ChatModal
					isOpen={isChatOpen}
					onOpenChange={onChatOpenChange}
					data={data}
					provider={selectedProviderId}
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
						id={id}
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
							selectedProviderId,
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
	const aiAllowed = isAIAllowed(data?.item);
	const isAIEnabled = useLibraryFeature("ai");

	if (!isAIEnabled || !aiAllowed) return null;

	return (
		<AiButton
			data={data}
			variant={variant}
		/>
	);
}
