"use client";

import { ItemGetResponse } from "@/app/api/item/types";
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
import { useMemo, useState } from "react";
import { BsStars } from "react-icons/bs";
import { useLocalStorage } from "usehooks-ts";
import { MotionConfig, motion } from "framer-motion";
import { AIHistory } from "@/types/ai";
import ModelSelector from "@/components/features/ai/ModelSelector";
import { useAIFeature } from "@/hooks/useAIFeature";
import { AI_DROPDOWN_ITEMS } from "@/components/features/ai/AIDropdownItems";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { twMerge } from "@/lib/tw-merge";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import { analyticsIdField } from "@/lib/ai/chat-request";
import { publicationPdfCitationSources } from "@/lib/ai/citations";

function randomUUID() {
	return (
		Math.random().toString(36).substring(2, 15) +
		Math.random().toString(36).substring(2, 15)
	);
}

function saveHistoryEntry(
	previous: Record<string, AIHistory[]>,
	feature: string,
	entry: AIHistory,
) {
	const history = previous[feature] ?? [];
	const exists = history.some(({ id }) => id === entry.id);
	const next = exists
		? history.map((item) =>
				item.id === entry.id
					? { ...item, content: entry.content }
					: item,
			)
		: [entry, ...history];
	return { ...previous, [feature]: next };
}

type AIFeature = ReturnType<typeof useAIFeature>;
type HistoriesSetter = (
	value:
		| Record<string, AIHistory[]>
		| ((
				previous: Record<string, AIHistory[]>,
		  ) => Record<string, AIHistory[]>),
) => void;

function AiModals({
	data,
	explainFeature,
	explainTitle,
	hasChatConversation,
	histories,
	id,
	isChangeOpen,
	isChatOpen,
	onChangeOpenChange,
	onChatOpenChange,
	onConversationStateChange,
	onModelChange,
	questions,
	selectedModelId,
	setHistories,
	summaryFeature,
	summaryTitle,
}: {
	data: ItemGetResponse | undefined;
	explainFeature: AIFeature;
	explainTitle: string;
	hasChatConversation: boolean;
	histories: Record<string, AIHistory[]>;
	id: string;
	isChangeOpen: boolean;
	isChatOpen: boolean;
	onChangeOpenChange: () => void;
	onChatOpenChange: () => void;
	onConversationStateChange: (hasConversation: boolean) => void;
	onModelChange: (modelId: string) => void;
	questions: string[] | undefined;
	selectedModelId: string | null;
	setHistories: HistoriesSetter;
	summaryFeature: AIFeature;
	summaryTitle: string;
}) {
	const pdfSources = useMemo(
		() =>
			publicationPdfCitationSources(
				data?.item?.key,
				data?.item?.attachmentsData,
			),
		[data?.item?.key, data?.item?.attachmentsData],
	);
	const generativeFeatures = [
		{ feature: summaryFeature, title: summaryTitle },
		{ feature: explainFeature, title: explainTitle },
	];

	return (
		<>
			<ModelSelector
				isOpen={isChangeOpen}
				onOpenChange={onChangeOpenChange}
				selectedModelId={selectedModelId}
				onModelChange={onModelChange}
				hasConversation={hasChatConversation}
				onResetConversation={() => onConversationStateChange(false)}
			/>
			<ChatModal
				key={selectedModelId ?? "no-model"}
				isOpen={isChatOpen}
				onOpenChange={onChatOpenChange}
				data={data}
				modelId={selectedModelId}
				onModelChange={onModelChange}
				onConversationStateChange={onConversationStateChange}
				questions={questions}
			/>
			{generativeFeatures.map(({ feature, title }) => (
				<GenerativeModal
					key={feature.key}
					feature={feature}
					title={title}
					history={histories[feature.key] || []}
					setHistory={(history) =>
						setHistories((previous) => ({
							...previous,
							[feature.key]: history,
						}))
					}
					id={id}
					currentTitle={data!.item!.title!}
					currentKey={data!.item!.key!}
					currentModelId={selectedModelId}
					onClearCurrent={() => feature.setCompletion("")}
					pdfSources={pdfSources}
				/>
			))}
		</>
	);
}

function AiMenu({
	ariaLabel,
	items,
	label,
	variant,
}: {
	ariaLabel: string;
	items: ReturnType<typeof AI_DROPDOWN_ITEMS>;
	label: string;
	variant?: "default" | "inline";
}) {
	return (
		<Dropdown classNames={{ content: "bg-white dark:bg-secondary" }}>
			<DropdownTrigger>
				<Button
					isIconOnly={variant === "default"}
					aria-label={ariaLabel}
					className={twMerge(
						variant === "default" && "!p-0 rounded-full ",
					)}
					size={variant === "inline" ? "sm" : "lg"}
				>
					<BsStars />
					{variant === "inline" && label}
				</Button>
			</DropdownTrigger>
			<DropdownMenu
				items={items}
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
	);
}

function AiButton({
	data,
	variant,
}: {
	data: ItemGetResponse | undefined;
	variant?: "default" | "inline";
}) {
	const { selectedModelId, setSelectedModelId, modelPresentation } =
		useSelectedModel();
	const body = {
		prompt: data?.item?.key,
		...analyticsIdField(getAnalyticsDistinctId()),
	};
	const locale = useLocale();

	const { isOpen: isChatOpen, onOpenChange: onChatOpenChange } =
		useDisclosure();
	const { isOpen: isChangeOpen, onOpenChange: onChangeOpenChange } =
		useDisclosure();

	const { data: questions } = useSWR(
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
	const [histories, setHistories] = useLocalStorage<
		Record<string, AIHistory[]>
	>(`ai-history-v2`, {});

	const updateHistory = (prompt: string, completion: string, id: string) => {
		if (!selectedModelId) return;
		setHistories((previous) =>
			saveHistoryEntry(previous, prompt, {
				id,
				content: completion,
				date: new Date(),
				title: data!.item!.title!,
				key: data!.item!.key!,
				modelId: selectedModelId,
			}),
		);
	};

	const summaryFeature = useAIFeature(
		"summarize",
		id,
		updateHistory,
		data,
		selectedModelId,
	);
	const explainFeature = useAIFeature(
		"explain",
		id,
		updateHistory,
		data,
		selectedModelId,
	);

	const handleModelChange = (modelId: string) => {
		setSelectedModelId(modelId);
		setHasChatConversation(false);
		[summaryFeature, explainFeature].forEach((feature) => {
			feature.setCompletion("");
		});
		setId(crypto.randomUUID());
	};
	const menuItems = AI_DROPDOWN_ITEMS(
		t,
		modelPresentation,
		onChangeOpenChange,
		summaryFeature,
		explainFeature,
		onChatOpenChange,
	);

	return (
		<motion.div
			className={twMerge(
				"",
				variant === "default" &&
					"fixed bottom-0 right-0 z-40 print:hidden",
			)}
			// Only the floating button slides in from the edge; the header's stands still with the buttons beside it.
			initial={variant === "default" ? { opacity: 0, x: 100 } : false}
			animate={{ opacity: 1, x: 0 }}
		>
			<div
				className={twMerge(
					"flex items-center justify-center",
					variant === "default" && " p-4",
				)}
			>
				<AiModals
					data={data}
					explainFeature={explainFeature}
					explainTitle={t("explain")}
					hasChatConversation={hasChatConversation}
					histories={histories}
					id={id}
					isChangeOpen={isChangeOpen}
					isChatOpen={isChatOpen}
					onChangeOpenChange={onChangeOpenChange}
					onChatOpenChange={onChatOpenChange}
					onConversationStateChange={setHasChatConversation}
					onModelChange={handleModelChange}
					questions={questions}
					selectedModelId={selectedModelId}
					setHistories={setHistories}
					summaryFeature={summaryFeature}
					summaryTitle={t("summarize")}
				/>
				<AiMenu
					ariaLabel={tUI("aiMenuAriaLabel")}
					items={menuItems}
					label={t("askAI")}
					variant={variant}
				/>
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
	const isAIEnabled = useLibraryFeature("ai");

	if (!isAIEnabled || !data?.item) return null;

	return (
		<MotionConfig reducedMotion="user">
			<AiButton data={data} variant={variant} />
		</MotionConfig>
	);
}
