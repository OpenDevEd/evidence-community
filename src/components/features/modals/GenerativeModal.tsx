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
import FullScreenModal from "@/components/nextui/FullScreenModal";
import { useMemo, useState } from "react";
import { BiTrash } from "react-icons/bi";
import { AIMarkdown } from "../markdown/Markdown";
import { AnimatePresence, motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getAIModelPresentation } from "@/constants/ai";
import React from "react";
import { Button } from "@/components/nextui/Button";
import { AIHistory } from "@/types/ai";
import { BsClockHistory, BsStars } from "react-icons/bs";
import { AIContentControls } from "./AIControls";
import { twMerge } from "tailwind-merge";
import useBreakpoint from "@/hooks/useBreakpoint";
import { RiErrorWarningFill } from "react-icons/ri";
import { ImSpinner8 } from "react-icons/im";
import { IoChevronDown } from "react-icons/io5";
import { useStickToBottom } from "use-stick-to-bottom";
import { clientAIError } from "@/lib/ai/client";
import type { useAIFeature } from "@/hooks/useAIFeature";

export default function GenerativeModal({
	history,
	setHistory,
	feature,
	title,
	id,
	currentTitle,
	currentKey,
	currentModelId,
	onClearCurrent,
	pdfSources = {},
}: {
	history: AIHistory[];
	setHistory: (history: AIHistory[]) => void;
	feature: ReturnType<typeof useAIFeature>;
	title: string;
	id: string;
	currentTitle: string;
	currentKey: string;
	currentModelId: string | null;
	onClearCurrent: () => void;
	pdfSources?: Record<string, string>;
}) {
	const {
		isOpen,
		onOpenChange,
		response: content,
		error,
		isLoading,
		retry: onRetry,
	} = feature;
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const { ai } = useLibraryConfig();
	const format = useFormatter();
	const [selection, setSelection] = useState({
		requestId: id,
		historyId: id,
	});
	const selectedHistoryId =
		selection.requestId === id ? selection.historyId : id;
	const {
		scrollRef,
		contentRef: scrollContentRef,
		isAtBottom,
		scrollToBottom,
	} = useStickToBottom({
		initial: "smooth",
		resize: "smooth",
	});
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
	const isDesktop = useBreakpoint("lg");
	const currentDate = useMemo(() => new Date(), [id]);
	const persistedCurrentItem = history.find((item) => item.id === id);
	const hasCurrentRequest =
		isLoading || content.length > 0 || error !== undefined;
	const currentItem =
		hasCurrentRequest && currentModelId
			? {
					id,
					content,
					date: persistedCurrentItem?.date ?? currentDate,
					title: currentTitle,
					key: currentKey,
					modelId: currentModelId,
				}
			: undefined;
	const displayHistory = currentItem
		? [currentItem, ...history.filter((item) => item.id !== currentItem.id)]
		: history;
	const selectedHistoryItem =
		displayHistory.find((item) => item.id === selectedHistoryId) ??
		displayHistory[0];
	const isShowingCurrentRequest = selectedHistoryItem?.id === id;
	const contentToDisplay = selectedHistoryItem?.content ?? "";
	const visibleErrorMessage = error
		? clientAIError(error).message || t("errorMessage")
		: "";

	const deleteSelectedHistory = () => {
		if (!selectedHistoryItem) return;

		const selectedIndex = displayHistory.findIndex(
			(item) => item.id === selectedHistoryItem.id,
		);
		const remainingHistory = displayHistory.filter(
			(item) => item.id !== selectedHistoryItem.id,
		);
		setHistory(
			history.filter((item) => item.id !== selectedHistoryItem.id),
		);
		if (isShowingCurrentRequest) onClearCurrent();
		setSelection({
			requestId: id,
			historyId:
				remainingHistory[
					Math.min(selectedIndex, remainingHistory.length - 1)
				]?.id ?? "",
		});
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
						<AIHeader onClose={onClose}>{title}</AIHeader>
						<ModalBody className="w-full h-full p-0 lg:grid grid-cols-12 overflow-hidden">
							<AnimatePresence mode="popLayout">
								{(isHistoryOpen || isDesktop) && (
									<motion.div
										key="history"
										initial={{ x: -300, opacity: 0 }}
										animate={{ x: 0, opacity: 1 }}
										exit={{ x: -300, opacity: 0 }}
										transition={{ type: "tween", duration: 0.2 }}
										className="col-span-3 w-full h-full overflow-y-hidden"
									>
										<ScrollShadow className="w-full gap-2 p-2 dark:bg-secondary bg-white lg:rounded-tr-3xl lg:rounded-bl-xl h-full">
											<Listbox
												aria-label={t("history")}
												selectionMode="single"
												onSelectionChange={(keys) => {
													const key =
														typeof keys === "string"
															? keys
															: Array.from(keys)[0];
													if (key !== undefined) {
														setSelection({
															requestId: id,
															historyId: String(key),
														});
													}
													setIsHistoryOpen(false);
												}}
												selectedKeys={
													selectedHistoryItem
														? [selectedHistoryItem.id]
														: []
												}
												disallowEmptySelection
											>
												{displayHistory.map((item) => {
													const HistoryModelIcon =
														getAIModelPresentation(
															item.modelId,
															ai.providers,
														).icon ?? BsStars;
													return (
														<ListboxItem
															key={item.id}
															textValue={item.title}
															startContent={
																<div className="size-8 aspect-square shrink-0 p-2 bg-accent rounded-full group icon-container">
																	{item.id === id &&
																	isLoading ? (
																		<ImSpinner8 className="h-full animate-spin fill-white" />
																	) : (
																		React.createElement(
																			HistoryModelIcon,
																			{
																				className:
																					"h-full fill-white group-[.icon-container:hover]:scale-90 transition-all duration-300",
																			},
																		)
																	)}
																</div>
															}
															className="data-[selected]:opacity-100 lg:opacity-50 p-2 pr-4 rounded-full"
														>
															<div className="text-base font-medium line-clamp-1 leading-5">
																{item.title}
															</div>
															<div className="text-xs text-black/50 dark:text-white/50 leading-4">
																{format.dateTime(new Date(item.date), {
																	year: "2-digit",
																	month: "2-digit",
																	day: "2-digit",
																})}
															</div>
														</ListboxItem>
													);
												})}
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
										transition={{ type: "tween", duration: 0.2 }}
										className="w-full col-span-9 flex flex-col h-full overflow-y-hidden"
									>
										<div className="w-full dark:bg-secondary bg-white lg:rounded-tl-3xl p-2 flex gap-1 shrink-0">
											<Button
												size="sm"
												startContent={<BsClockHistory />}
												onPress={() => setIsHistoryOpen(true)}
												className="lg:hidden"
											>
												{t("history")}
											</Button>
											<AIContentControls
												content={contentToDisplay}
												isDisabled={!contentToDisplay}
											/>
											{selectedHistoryItem && (
												<Tooltip
													content={format.dateTime(
														new Date(selectedHistoryItem.date),
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
															new Date(selectedHistoryItem.date),
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
												startContent={<BiTrash />}
												isDisabled={
													(isLoading && isShowingCurrentRequest) ||
													!selectedHistoryItem
												}
												onPress={deleteSelectedHistory}
												aria-label={tUI("deleteHistoryItemAriaLabel")}
											>
												<span className="hidden lg:block">
													{t("delete")}
												</span>
											</Button>
										</div>
										<div className="w-full h-full relative overflow-hidden">
											<div
												key={selectedHistoryItem?.id}
												ref={scrollRef}
												className="absolute inset-0 h-full w-full overflow-y-auto overflow-x-hidden rounded-br-xl bg-white dark:bg-secondary"
											>
												<div
													ref={scrollContentRef}
													className="flex min-h-full w-full flex-col"
												>
													<Skeleton
														isLoaded={
															!isLoading ||
															contentToDisplay.length > 0 ||
															!!error ||
															!isShowingCurrentRequest
														}
														className="relative w-full flex-1 rounded-br-xl"
													>
														{error && isShowingCurrentRequest ? (
															<div
																role="alert"
																className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl bg-red-500/10 px-24 text-center text-xl text-red-500 text-balance"
															>
																<motion.div
																	className="flex flex-col items-center gap-4"
																	initial={{ opacity: 0, y: -100 }}
																	animate={{ opacity: 1, y: 0 }}
																	exit={{ opacity: 0, y: 100 }}
																	transition={{ delay: 0.5 }}
																>
																	<RiErrorWarningFill className="size-32 opacity-50" />
																	<p>{visibleErrorMessage}</p>
																	<Button
																		size="sm"
																		variant="transparent"
																		className="rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/15"
																		onPress={onRetry}
																	>
																		{tUI("retry")}
																	</Button>
																</motion.div>
															</div>
														) : (
															<AIMarkdown
																className="prose dark:prose-invert space-y-2 max-w-full p-6"
																pdfSources={pdfSources}
																isAnimating={
																	isLoading &&
																	isShowingCurrentRequest
																}
															>
																{contentToDisplay}
															</AIMarkdown>
														)}
													</Skeleton>
												</div>
											</div>
											{!isAtBottom && (
												<Button
													isIconOnly
													size="sm"
													className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
													aria-label="Scroll to bottom"
													onPress={() => void scrollToBottom()}
												>
													<IoChevronDown className="size-4" />
												</Button>
											)}
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
