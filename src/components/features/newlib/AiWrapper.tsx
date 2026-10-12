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
import { useTranslations } from "next-intl";
import { use, useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { SparklesIcon } from "@hugeicons/core-free-icons";
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
import { AskAboutConversation, attachedItem, useAskAbout } from "@/components/features/ai/AskAbout";
import { publicationPdfCitationSources } from "@/lib/ai/citations";
import { CitedPublications } from "@/components/features/markdown/Citation";

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
	histories,
	id,
	isChangeOpen,
	onChangeOpenChange,
	onModelChange,
	selectedModelId,
	setHistories,
	summaryFeature,
	summaryTitle,
}: {
	data: ItemGetResponse | undefined;
	explainFeature: AIFeature;
	explainTitle: string;
	histories: Record<string, AIHistory[]>;
	id: string;
	isChangeOpen: boolean;
	onChangeOpenChange: () => void;
	onModelChange: (modelId: string) => void;
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
	// The summary and explanation cite this publication.
	const item = data?.item;
	const cited = item?.key ? { [item.key]: item } : {};
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
				hasConversation={use(AskAboutConversation)}
			/>
			<CitedPublications value={cited}>
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
			</CitedPublications>
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
					<HugeiconsIcon icon={SparklesIcon} />
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

/** Only the floating button slides in from the edge; the header's stands still with the buttons beside it. */
function entrance(variant: "default" | "inline" | undefined) {
	return variant === "inline" ? false : { opacity: 0, x: 100 };
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
	// The chat is the page's own, shared with every card's Ask AI, so this publication joins whatever is being discussed.
	const askAbout = useAskAbout();
	const { isOpen: isChangeOpen, onOpenChange: onChangeOpenChange } =
		useDisclosure();
	const [id, setId] = useState(randomUUID);
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
		() => {
			const item = attachedItem(data?.item);
			if (item) askAbout?.(item);
		},
	// Where the page has no chat, as in the admin's preview, the menu offers no Ask AI.
	).filter((item) => askAbout || item.key !== "chat");

	return (
		<motion.div
			className={twMerge(
				"",
				variant === "default" &&
					"fixed bottom-0 right-0 z-40 print:hidden",
			)}
			initial={entrance(variant)}
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
					histories={histories}
					id={id}
					isChangeOpen={isChangeOpen}
					onChangeOpenChange={onChangeOpenChange}
					onModelChange={handleModelChange}
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
