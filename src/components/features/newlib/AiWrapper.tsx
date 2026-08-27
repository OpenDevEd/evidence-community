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
import { fetcher, fetcherPOST } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { motion } from "framer-motion";
import { AIHistory } from "@/types/ai";
import ModelSelector from "@/components/features/ai/ModelSelector";
import { useAIFeature } from "@/hooks/useAIFeature";
import { AI_DROPDOWN_ITEMS } from "@/components/features/ai/AIDropdownItems";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { twMerge } from "tailwind-merge";
import { hasVisiblePdfAttachment } from "@/lib/attachment-visibility";
import type { AIModelId } from "@/lib/ai/models";
import { publicationPdfCitationSources } from "@/lib/ai/citations";
import { toast } from "@/components/layout/Toast";
import { upsertAIHistory } from "@/lib/ai/history";

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
	const { selectedModel, setSelectedModel } = useSelectedModel();
	const body = {
		prompt: data?.item?.key,
		distinctId: getAnalyticsDistinctId() ?? undefined,
	};
	const locale = useLocale();

	const { isOpen: isChatOpen, onOpenChange: onChatOpenChange } =
		useDisclosure();
	const { isOpen: isChangeOpen, onOpenChange: onChangeOpenChange } =
		useDisclosure();

	const { data: questions, error: questionsError } = useSWR<string[]>(
		isChatOpen
			? [
					`/ai/questions`,
					body,
					{
						"Accept-Language": locale,
					},
				]
			: null,
		fetcherPOST,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
		},
	);
	const [id, setId] = useState(randomUUID);
	const [hasChatConversation, setHasChatConversation] = useState(false);
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	useEffect(() => {
		if (!(questionsError instanceof Error)) return;
		toast({ title: questionsError.message, type: "error" });
	}, [questionsError]);
	const pdfSources = useMemo(
		() =>
			publicationPdfCitationSources(
				data?.item?.key,
				data?.item?.attachmentsData,
			),
		[data?.item?.key, data?.item?.attachmentsData],
	);

	const [histories, setHistories] = useLocalStorage<
		Record<string, AIHistory[]>
	>(`ai-history`, {});

	const updateHistory = (prompt: string, completion: string, id: string) => {
		setHistories((prev) => {
			const history = prev[prompt] || [];
			const existing = history.find((item) => item.id === id);
			return {
				...prev,
				[prompt]: upsertAIHistory(history, {
					id,
					content: completion,
					date: existing?.date ?? new Date(),
					title: data!.item!.title!,
					key: data!.item!.key!,
					modelId: selectedModel,
				}),
			};
		});
	};

	const summaryFeature = useAIFeature(
		"summarize",
		id,
		updateHistory,
		data,
		selectedModel,
	);
	const explainFeature = useAIFeature(
		"explain",
		id,
		updateHistory,
		data,
		selectedModel,
	);

	const handleModelChange = (modelId: AIModelId) => {
		setSelectedModel(modelId);
		setHasChatConversation(false);
		[summaryFeature, explainFeature].forEach((feature) => {
			feature.setCompletion("");
		});
		setId(crypto.randomUUID());
	};

	return (
		<motion.div
			className={twMerge(
				"",
				variant === "default" &&
					"fixed bottom-0 right-0 z-40 print:hidden",
			)}
			initial={{ opacity: 0, x: 100 }}
			animate={{ opacity: 1, x: 0 }}
		>
			<div
				className={twMerge(
					"flex items-center justify-center",
					variant === "default" && " p-4",
				)}
			>
				<ModelSelector
					isOpen={isChangeOpen}
					onOpenChange={onChangeOpenChange}
					selectedModel={selectedModel}
					onModelChange={handleModelChange}
					hasConversation={hasChatConversation}
				/>
				<ChatModal
					key={selectedModel}
					isOpen={isChatOpen}
					onOpenChange={onChatOpenChange}
					data={data}
					modelId={selectedModel}
					questions={questions}
					onModelChange={handleModelChange}
					onConversationStateChange={setHasChatConversation}
				/>
				{[summaryFeature, explainFeature].map((feature) => (
					<GenerativeModal
						key={feature.key}
						isOpen={feature.isOpen}
						onOpenChange={feature.onOpenChange}
						content={feature.response}
						title={t(feature.key)}
						isLoading={feature.isLoading}
						hasCurrentRequest={feature.hasRequested}
						error={feature.error}
						history={histories[feature.key] || []}
						setHistory={(history) =>
							setHistories((prev) => ({
								...prev,
								[feature.key]: history,
							}))
						}
						id={id}
						currentTitle={data!.item!.title!}
						currentKey={data!.item!.key!}
						currentModelId={selectedModel}
						onClearCurrent={() => feature.setCompletion("")}
						pdfSources={pdfSources}
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
								variant === "default" && "!p-0 rounded-full ",
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
	const { data: aiStatus } = useSWR<{ enabled: boolean }>(
		"/ai/status",
		fetcher,
	);
	const aiAllowed = hasVisiblePdfAttachment(data?.item);
	const isAIEnabled = useFeatureFlagEnabled("ai-features");

	if (!isAIEnabled || !aiAllowed || aiStatus?.enabled !== true) return null;

	return <AiButton key={data?.item?.key} data={data} variant={variant} />;
}
