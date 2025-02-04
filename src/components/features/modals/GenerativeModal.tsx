import {
	Listbox,
	ListboxItem,
	ModalBody,
	ScrollShadow,
	Tooltip
} from "@nextui-org/react";
import { ModalContent } from "@nextui-org/react";
import { Skeleton } from "@/components/nextui/Skeleton";
import AIHeader from "../ai/AIHeader";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import { useMemo, useRef, useState } from "react";
import {
	BiCopy,
	BiSolidBookBookmark,
	BiSolidBookContent,
	BiTrash
} from "react-icons/bi";
import { AIMarkdown } from "../markdown/Markdown";
import { AnimatePresence, motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { models } from "@/constants/ai";
import React from "react";
import { Button } from "@/components/nextui/Button";
import { AIHistory } from "@/types/ai";
import {
	BsBodyText,
	BsClockHistory,
	BsCodeSlash,
	BsMarkdown,
} from "react-icons/bs";
import { AIControls } from "./AIControls";
import { twMerge } from "tailwind-merge";
import useBreakpoint from "@/hooks/useBreakpoint";

export default function GenerativeModal({
	history,
	setHistory,
	isOpen,
	onOpenChange,
	content,
	title,
	error,
	id,
}: {
	history: AIHistory[];
	setHistory: (history: AIHistory[]) => void;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	content: string;
	title: string;
	error?: Error;
	id: string;
}) {
	const t = useTranslations("ai");
	const format = useFormatter();
	const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(0);
	const selectedHistoryItem = history[selectedHistoryIndex];
	const contentRef = useRef<HTMLDivElement>(null);
	const currentItem = useMemo(() => {
		return history.find((item) => item.id === id);
	}, [id, history]);
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
	const isDesktop = useBreakpoint("xl");

	const isSelectedCurrentItem = selectedHistoryItem == currentItem;

	const contentToDisplay = useMemo(() => {
		return isSelectedCurrentItem
			? !!selectedHistoryItem
				? content
				: ""
			: selectedHistoryItem.content;
	}, [selectedHistoryItem, currentItem, content]);

	return (
		<FullScreenModal
			className="max-w-6xl"
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<ModalContent className="p-0 h-[45rem] max-h-screen overflow-x-hidden">
				{(onClose) => (
					<>
						<AIHeader isLoading={false} onClose={onClose}>
							{title}
						</AIHeader>
						<ModalBody className="w-full h-full p-0 xl:grid grid-cols-12 overflow-hidden">
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
											"col-span-3 w-full h-full overflow-y-hidden"
										)}
									>
										<ScrollShadow
											className={twMerge(
												"w-full gap-2 p-2 dark:bg-secondary bg-white xl:rounded-tr-3xl xl:rounded-bl-xl h-full"
											)}
										>
											<Listbox
												selectionMode="single"
												onSelectionChange={(keys) => {
													const key =
														typeof keys === "string"
															? keys
															: Array.from(
																	keys
															  )[0];
													setSelectedHistoryIndex(
														Number(key)
													);
													setIsHistoryOpen(false);
												}}
												selectedKeys={isDesktop ? [
													selectedHistoryIndex.toString(),
												] : []}
												disallowEmptySelection={isDesktop}
											>
												{history.map((item, index) => (
													<ListboxItem
														key={index}
														startContent={
															<div className="size-8 aspect-square shrink-0 p-2 bg-accent rounded-full group icon-container">
																{models[item.modelIndex]?.icon && React.createElement(
																	models[
																		item
																			.modelIndex
																	]?.icon,
																	{
																		className:
																			"h-full fill-white group-[.icon-container:hover]:scale-90 transition-all duration-300",
																	}
																)}
															</div>
														}
														className="data-[selected]:opacity-100 xl:opacity-50 p-2 pr-4 rounded-full"
													>
														<div className="text-base font-medium line-clamp-1 leading-5">
															{item.title}
														</div>
														<div className="text-xs text-black/50 dark:text-white/50 leading-4">
															{format.dateTime(new Date(item.date), {
																year: "2-digit",
																month: "2-digit",
																day: "2-digit"
															})}
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
											"w-full col-span-9 flex flex-col h-full overflow-y-hidden"
										)}
									>
										<div className="w-full dark:bg-secondary bg-white xl:rounded-tl-3xl p-2 flex gap-1 shrink-0">
											<Button
												size="sm"
												startContent={
													<BsClockHistory />
												}
												onPress={() =>
													setIsHistoryOpen(true)
												}
												className="xl:hidden"
											>
												{t("history")}
											</Button>
											<AIControls
												controls={[
													{
														label: t("copyAsPlainText"),
														icon: <BsBodyText />,
														action: "plaintext",
													},
													{
														label: t("copyAsMarkdown"),
														icon: <BsMarkdown />,
														action: "markdown",
													},
													{
														label: t("copyAsHTML"),
														icon: <BsCodeSlash />,
														action: "html",
													},
												]}
												contentRef={contentRef}
												content={contentToDisplay}
												type="copy"
												buttonLabel={t("copy")}
												buttonIcon={<BiCopy />}
											/>
											<AIControls
												contentRef={contentRef}
												controls={[
													{
														label: t("exportAsPlainText"),
														icon: <BsBodyText />,
														action: "plaintext",
													},
													{
														label: t("exportAsMarkdown"),
														icon: <BsMarkdown />,
														action: "markdown",
													},
													{
														label: t("exportAsHTML"),
														icon: <BsCodeSlash />,
														action: "html",
													}
												]}
												content={contentToDisplay}
												type="download"
												buttonLabel={t("export")}
												buttonIcon={
													<BiSolidBookContent />
												}
											/>
											{selectedHistoryItem && (
												<Tooltip
													content={format.dateTime(new Date(selectedHistoryItem.date), {
														year: 'numeric',
														month: 'long',
														day: 'numeric',
														hour: 'numeric',
														minute: 'numeric',
														second: 'numeric'
													})}
												>
													<div className="text-xs text-black/50 dark:text-white/50 flex-1 flex justify-center items-center">
														{format.dateTime(new Date(selectedHistoryItem.date), {
															year: "numeric",
															month: "long",
															day: "numeric"
														})}
													</div>
												</Tooltip>
											)}
											<Button
												size="sm"
												className="ltr:ml-auto rtl:mr-auto dark:hover:bg-red-600 min-w-0"
												startContent={<BiTrash />}
												onPress={() => {
													if (selectedHistoryItem) {
														setHistory(
															history.filter(
																(_, index) =>
																	index !==
																	selectedHistoryIndex
															)
														);
														setSelectedHistoryIndex(
															(prev) =>
																prev == 0
																	? 0
																	: prev - 1
														);
													}
												}}
												aria-label={"Delete history item"}
											>
												<span className="hidden xl:block">
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
													isLoaded={
														contentToDisplay.length >
															0 ||
														!!error ||
														!isSelectedCurrentItem ||
														!selectedHistoryItem
													}
													className="w-full relative rounded-br-xl min-h-full"
												>
													{error &&
													isSelectedCurrentItem ? (
														<div className="text-red-500 flex items-center justify-center text-xl absolute inset-0 bg-red-500/10 rounded-2xl text-center px-24 text-balance overflow-hidden ">
															<motion.div
																initial={{
																	opacity: 0,
																	y: -100,
																}}
																animate={{
																	opacity: 1,
																	y: 0,
																}}
																exit={{
																	opacity: 0,
																	y: 100,
																}}
																transition={{
																	delay: 0.5,
																}}
															>
																{t(
																	"errorMessage"
																)}
															</motion.div>
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
