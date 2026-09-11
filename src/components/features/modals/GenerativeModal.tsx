import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Delete02Icon, WorkHistoryIcon } from "@hugeicons/core-free-icons";
import {
	Listbox,
	ListboxItem,
	ModalBody,
	ScrollShadow,
	Tooltip,
} from "@nextui-org/react";
import { ModalContent } from "@nextui-org/react";
import { Skeleton } from "@/components/nextui/Skeleton";
import AIHeader from "../ai/AIHeader";
import { ChatErrorCard } from "../ai/chat-shared";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import { useRef, useState } from "react";
import { AIMarkdown } from "../markdown/Markdown";
import { AnimatePresence, motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getAIModelPresentation } from "@/constants/ai";
import React from "react";
import { Button } from "@/components/nextui/Button";
import { AIHistory } from "@/types/ai";
import { AIContentControls } from "./AIControls";
import { twMerge } from "tailwind-merge";
import useBreakpoint from "@/hooks/useBreakpoint";
import { clientAIError } from "@/lib/ai/client";
import type { useAIFeature } from "@/hooks/useAIFeature";

export default function GenerativeModal({
	history,
	setHistory,
	feature,
	title,
	id,
}: {
	history: AIHistory[];
	setHistory: (history: AIHistory[]) => void;
	feature: ReturnType<typeof useAIFeature>;
	title: string;
	id: string;
}) {
	const { isOpen, onOpenChange, response: content, error, isLoading, retry: onRetry } = feature;
	const t = useTranslations("ai");
	const { ai } = useLibraryConfig();
	const tUI = useTranslations("ui");

	const format = useFormatter();
	const [historySelection, setSelectedHistoryIndex] = useState<number | null>(null);
	const selectedHistoryIndex = historySelection ?? history.findIndex(item => item.id === id);
	const selectedHistoryItem = history[selectedHistoryIndex];
	const contentRef = useRef<HTMLDivElement>(null);

	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
	const isDesktop = useBreakpoint("lg");

	const isSelectedCurrentItem = historySelection === null || selectedHistoryItem?.id === id;
	const contentToDisplay = isSelectedCurrentItem ? content : selectedHistoryItem?.content ?? "";

	const deleteSelectedHistory = () => {
		if (!selectedHistoryItem) return;
		setHistory(history.filter((_, index) => index !== selectedHistoryIndex));
		setSelectedHistoryIndex(Math.max(0, selectedHistoryIndex - 1));
	};

	return (
		<FullScreenModal
			className="max-w-6xl"
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<ModalContent className="h-generative-modal max-h-screen overflow-x-hidden p-0">
				{(onClose) => (
					<>
						<AIHeader isLoading={isLoading && isSelectedCurrentItem} onClose={onClose}>
							{title}
						</AIHeader>
						<ModalBody className="w-full h-full p-0 lg:grid grid-cols-12 overflow-hidden">
							<AnimatePresence mode="popLayout">
								{(isHistoryOpen || isDesktop) && (
									<motion.div
										key="history"
										initial={{ x: -300, opacity: 0 }}
										animate={{ x: 0, opacity: 1 }}
										exit={{ x: -300, opacity: 0 }}
										transition={{
											type: "tween",
											duration: 0.2,
										}}
										className={twMerge(
											"col-span-3 w-full h-full overflow-y-hidden",
										)}
									>
										<ScrollShadow
											className={twMerge(
												"w-full gap-2 p-2 dark:bg-secondary bg-white lg:rounded-tr-3xl lg:rounded-bl-xl h-full",
											)}
										>
											<Listbox
												aria-label={t("history")}
												selectionMode="single"
												onSelectionChange={(keys) => {
													const key =
														typeof keys === "string"
															? keys
															: Array.from(
																	keys,
																)[0];
													setSelectedHistoryIndex(
														Number(key),
													);
													setIsHistoryOpen(false);
												}}
												selectedKeys={
													isDesktop && selectedHistoryIndex >= 0
														? [
																selectedHistoryIndex.toString(),
															]
														: []
												}
												disallowEmptySelection={
													isDesktop
												}
											>
												{history.map((item, index) => (
													<ListboxItem
														key={index}
														textValue={item.title}
														startContent={
															<div className="size-8 aspect-square shrink-0 p-2 bg-accent rounded-full group icon-container">
																{React.createElement(
																	getAIModelPresentation(
																		item.modelId, ai.providers,
																	).icon,
																	{
																		className:
																			"h-full fill-white group-[.icon-container:hover]:scale-90 transition-all duration-300",
																	},
																)}
															</div>
														}
														className="data-[selected]:opacity-100 lg:opacity-50 p-2 pr-4 rounded-full"
													>
														<div className="text-base font-medium line-clamp-1 leading-5">
															{item.title}
														</div>
														<div className="text-xs text-black/50 dark:text-white/50 leading-4">
															{format.dateTime(
																new Date(
																	item.date,
																),
																{
																	year: "2-digit",
																	month: "2-digit",
																	day: "2-digit",
																},
															)}
														</div>
													</ListboxItem>
												))}
											</Listbox>
										</ScrollShadow>
									</motion.div>
								)}
								{(!isHistoryOpen || isDesktop) && (
									<motion.div
										key="content"
										initial={{ x: 300, opacity: 0 }}
										animate={{ x: 0, opacity: 1 }}
										exit={{ x: 300, opacity: 0 }}
										transition={{
											type: "tween",
											duration: 0.2,
										}}
										className={twMerge(
											"w-full col-span-9 flex flex-col h-full overflow-y-hidden",
										)}
									>
										<div className="w-full dark:bg-secondary bg-white lg:rounded-tl-3xl p-2 flex gap-1 shrink-0">
											<Button
												size="sm"
												startContent={
													<HugeiconsIcon icon={WorkHistoryIcon} />
												}
												onPress={() =>
													setIsHistoryOpen(true)
												}
												className="lg:hidden"
											>
												{t("history")}
											</Button>
											<AIContentControls
												content={contentToDisplay}
												isDisabled={!contentToDisplay}
												contentRef={contentRef}
											/>
											{selectedHistoryItem && (
												<Tooltip
													content={format.dateTime(
														new Date(
															selectedHistoryItem.date,
														),
														{
															year: "numeric",
															month: "long",
															day: "numeric",
															hour: "numeric",
															minute: "numeric",
															second: "numeric",
														},
													)}
												>
													<div className="text-xs text-black/50 dark:text-white/50 flex-1 flex justify-center items-center">
														{format.dateTime(
															new Date(
																selectedHistoryItem.date,
															),
															{
																year: "numeric",
																month: "long",
																day: "numeric",
															},
														)}
													</div>
												</Tooltip>
											)}
											<Button
												size="sm"
												className="ltr:ml-auto rtl:mr-auto dark:hover:bg-red-600 min-w-0"
												startContent={<HugeiconsIcon icon={Delete02Icon} />}
												onPress={deleteSelectedHistory}
												isDisabled={!selectedHistoryItem}
												aria-label={tUI(
													"deleteHistoryItemAriaLabel",
												)}
											>
												<span className="hidden lg:block">
													{t("delete")}
												</span>
											</Button>
										</div>
										<div className="w-full h-full relative">
											<ScrollShadow
												key={selectedHistoryIndex}
												className="w-full dark:bg-secondary bg-white rounded-br-xl absolute inset-0 h-full"
											>
												<Skeleton
													isLoaded={!isLoading || !!contentToDisplay || !isSelectedCurrentItem}
													className="w-full relative rounded-br-xl min-h-full"
												>
													{error &&
													isSelectedCurrentItem ? (
														<div className="grid min-h-full place-items-center p-6">
															<ChatErrorCard message={clientAIError(error).message} isContextTooLarge={false} onReset={onRetry} onRetry={onRetry} className="max-w-lg" />
														</div>
													) : (
														<div ref={contentRef}>
															<AIMarkdown className="prose dark:prose-invert space-y-2 max-w-full p-6 ">
																{
																	contentToDisplay
																}
															</AIMarkdown>
														</div>
													)}
												</Skeleton>
											</ScrollShadow>
										</div>
									</motion.div>
								)}
							</AnimatePresence>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</FullScreenModal>
	);
}
