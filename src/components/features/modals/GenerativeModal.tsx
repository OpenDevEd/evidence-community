import {
	Listbox,
	ListboxItem,
	ModalBody,
	ScrollShadow,
} from "@nextui-org/react";
import { ModalContent } from "@nextui-org/react";
import { Skeleton } from "@/components/nextui/Skeleton";
import AIHeader from "../ai/AIHeader";
import AIModal from "@/components/nextui/AIModal";
import { useMemo, useState } from "react";
import {
	BiCopy,
	BiSolidBookBookmark,
	BiSolidBookContent,
	BiTrash,
} from "react-icons/bi";
import { AIMarkdown } from "../markdown/Markdown";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { models } from "@/constants/ai";
import React from "react";
import { Button } from "@/components/nextui/Button";
import { AIHistory } from "@/types/ai";
import CopyButton from "../items/CopyButton";

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
	const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(0);
	const selectedHistoryItem = history[selectedHistoryIndex];
	
	const currentItem = useMemo(() => {
		return history.find((item) => item.id === id);
	}, [id, history]);

	const isSelectedCurrentItem = selectedHistoryItem == currentItem;	

	const contentToDisplay = useMemo(() => {
		return isSelectedCurrentItem
			? !!selectedHistoryItem ? content : ""
			: selectedHistoryItem.content;
	}, [selectedHistoryItem, currentItem, content]);

	return (
		<AIModal
			className="max-w-6xl"
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<ModalContent className="p-0  h-[720px] max-h-screen">
				{(onClose) => (
					<>
						<AIHeader isLoading={false} onClose={onClose}>
							{title}
						</AIHeader>
						<ModalBody className="w-full p-0 grid grid-cols-12">
							<ScrollShadow className="col-span-3 w-full flex flex-col gap-2 p-2 dark:bg-secondary bg-white rounded-tr-3xl rounded-bl-xl">
								<Listbox
									selectionMode="single"
									onSelectionChange={(keys) => {
										const key = typeof keys === "string" ? keys : Array.from(keys)[0];
										setSelectedHistoryIndex(Number(key));
									}}
									selectedKeys={[selectedHistoryIndex.toString()]}
									disallowEmptySelection
								>
									{history.map((item, index) => (
										<ListboxItem
											key={index}
												startContent={
													<div className="h-full aspect-square shrink-0 p-2 bg-accent rounded-full group icon-container">
														{React.createElement(
															models[
																item.modelIndex
															].icon,
															{
																className:
																	"h-full fill-white group-[.icon-container:hover]:scale-90 transition-all duration-300",
															}
														)}
													</div>
												}
												className="data-[selected]:opacity-100 opacity-50 p-2 pr-4 rounded-full"
											>
												<div className="text-base font-medium line-clamp-1 leading-none">
													{item.title}
												</div>
												<div className="text-xs text-black/50 dark:text-white/50">
													{new Date(
														item.date
													).toLocaleString()}
												</div>
											</ListboxItem>
										)
									)}
								</Listbox>
							</ScrollShadow>
							<div className="w-full overflow-hidden col-span-9 flex flex-col">
								 <div className="w-full dark:bg-secondary bg-white rounded-tl-3xl p-2 flex gap-1">
									<CopyButton
										content={contentToDisplay}
									/>
									<Button
										size="sm"
										className="hidden"
										startContent={<BiSolidBookBookmark />}
									>
										Bookmark
									</Button>
									<Button
										size="sm"
										startContent={<BiSolidBookContent />}
									>
										Export
									</Button>
									{selectedHistoryItem && <div className="text-xs text-black/50 dark:text-white/50 flex-1 flex justify-center items-center">
										{`${new Date(
											selectedHistoryItem.date
										).toLocaleString(undefined, {
											year: "numeric",
											month: "long",
											day: "numeric",
											hour: "numeric",
											minute: "numeric",
											second: "numeric",
										})}`}
									</div>}
									<Button
										size="sm"
										className="ltr:ml-auto rtl:mr-auto dark:hover:bg-red-600"
										startContent={<BiTrash />}
										onPress={() => {
											if (selectedHistoryItem) {
												setHistory(history.filter((_, index) => index !== selectedHistoryIndex));
												setSelectedHistoryIndex((prev) => prev == 0 ? 0 : prev - 1);
											}
										}}
									>
										Delete
									</Button>
								</div>
								<ScrollShadow key={selectedHistoryIndex} className="w-full h-full dark:bg-secondary bg-white rounded-br-xl">
									<Skeleton
										isLoaded={
											(contentToDisplay.length > 0 ||
											!!error) || !isSelectedCurrentItem || !selectedHistoryItem
										}
										className="w-full h-full min-h-64 relative rounded-br-xl"
									>
										{(error && isSelectedCurrentItem) ? (
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
													transition={{ delay: 0.5 }}
												>
													{t("errorMessage")}
												</motion.div>
											</div>
										) : (
											<AIMarkdown className="prose dark:prose-invert space-y-2 max-w-full p-6 ">
												{contentToDisplay}
											</AIMarkdown>
										)}
									</Skeleton>
								</ScrollShadow>
							</div>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</AIModal>
	);
}
