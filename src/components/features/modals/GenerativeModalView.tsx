import {
	Listbox,
	ListboxItem,
	ModalBody,
	ScrollShadow,
} from "@nextui-org/react";
import { Tooltip } from "@/components/nextui/Tooltip";
import { ModalContent } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import type { useFormatter } from "next-intl";
import React from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, ArrowDown01Icon, Delete02Icon, HistoryIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { useStickToBottom } from "use-stick-to-bottom";

import AIHeader from "../ai/AIHeader";
import { AIMarkdown } from "../markdown/Markdown";
import { Button } from "@/components/nextui/Button";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import { Skeleton } from "@/components/nextui/Skeleton";
import { getAIModelPresentation } from "@/constants/ai";
import type { ConfiguredAIProvider } from "@/lib/ai/models";
import type { AIHistory } from "@/types/ai";
import { AIContentControls } from "./AIControls";

type Formatter = ReturnType<typeof useFormatter>;
type StickToBottom = ReturnType<typeof useStickToBottom>;

export type GenerativeHistoryView = {
	currentId: string;
	deleteDisabled: boolean;
	displayHistory: AIHistory[];
	format: Formatter;
	isLoading: boolean;
	label: string;
	onDelete: () => void;
	onSelect: (id: string) => void;
	providers: readonly ConfiguredAIProvider[];
	selectedItem: AIHistory | undefined;
};

export type GenerativeContentView = {
	content: string;
	errorMessage: string;
	isAnimating: boolean;
	isLoaded: boolean;
	onRetry: () => void;
	pdfSources?: Record<string, string>;
	selectedId?: string;
	showError: boolean;
	stickToBottom: StickToBottom;
};

function renderHistoryItem({
	currentId,
	format,
	isLoading,
	item,
	providers,
}: {
	currentId: string;
	format: Formatter;
	isLoading: boolean;
	item: AIHistory;
	providers: readonly ConfiguredAIProvider[];
}) {
	const HistoryModelIcon = getAIModelPresentation(
		item.modelId,
		providers,
	).icon;
	const isCurrentLoading = item.id === currentId && isLoading;

	return (
		<ListboxItem
			key={item.id}
			textValue={item.title}
			startContent={
				<div className="size-8 aspect-square shrink-0 p-2 bg-accent rounded-full group icon-container">
					{isCurrentLoading ? (
						<HugeiconsIcon icon={Loading03Icon} className="h-full animate-spin text-white" />
					) : (
						React.createElement(HistoryModelIcon, {
							className:
								"h-full text-white [&:not([fill=none])]:fill-current group-[.icon-container:hover]:scale-90 transition-all duration-300",
						})
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
}

function HistoryPanel({
	currentId,
	displayHistory,
	format,
	isLoading,
	label,
	onSelect,
	providers,
	selectedItem,
}: GenerativeHistoryView) {
	return (
		<ScrollShadow className="w-full gap-2 p-2 dark:bg-secondary bg-white lg:rounded-tr-3xl lg:rounded-bl-xl h-full">
			<Listbox
				aria-label={label}
				selectionMode="single"
				onSelectionChange={(keys) => {
					const key =
						typeof keys === "string" ? keys : Array.from(keys)[0];
					if (key !== undefined) onSelect(String(key));
				}}
				selectedKeys={selectedItem ? [selectedItem.id] : []}
				disallowEmptySelection
			>
				{displayHistory.map((item) =>
					renderHistoryItem({
						currentId,
						format,
						isLoading,
						item,
						providers,
					}),
				)}
			</Listbox>
		</ScrollShadow>
	);
}

function SelectedHistoryDate({
	format,
	item,
}: {
	format: Formatter;
	item: AIHistory;
}) {
	return (
		<Tooltip
			color="default"
			content={format.dateTime(new Date(item.date), {
				year: "numeric",
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "numeric",
				second: "numeric",
			})}
		>
			<div className="text-xs text-black/50 dark:text-white/50 flex-1 flex justify-center items-center">
				{format.dateTime(new Date(item.date), {
					year: "numeric",
					month: "long",
					day: "numeric",
				})}
			</div>
		</Tooltip>
	);
}

function ContentToolbar({
	content,
	pdfSources,
	deleteDisabled,
	format,
	onDelete,
	onHistoryOpen,
	selectedItem,
	deleteAriaLabel,
	deleteLabel,
	historyLabel,
}: {
	content: string;
	pdfSources?: Record<string, string>;
	deleteDisabled: boolean;
	format: Formatter;
	onDelete: () => void;
	onHistoryOpen: () => void;
	selectedItem: AIHistory | undefined;
	deleteAriaLabel: string;
	deleteLabel: string;
	historyLabel: string;
}) {
	return (
		<div className="w-full dark:bg-secondary bg-white lg:rounded-tl-3xl p-2 flex gap-1 shrink-0">
			<Button
				size="sm"
				startContent={<HugeiconsIcon icon={HistoryIcon} />}
				onPress={onHistoryOpen}
				className="lg:hidden"
			>
				{historyLabel}
			</Button>
			<AIContentControls content={content} isDisabled={!content} pdfSources={pdfSources} />
			{selectedItem && (
				<SelectedHistoryDate format={format} item={selectedItem} />
			)}
			<Button
				size="sm"
				className="ltr:ml-auto rtl:mr-auto dark:hover:bg-red-600 min-w-0"
				startContent={<HugeiconsIcon icon={Delete02Icon} />}
				isDisabled={deleteDisabled}
				onPress={onDelete}
				aria-label={deleteAriaLabel}
			>
				<span className="hidden lg:block">{deleteLabel}</span>
			</Button>
		</div>
	);
}

function GenerationError({
	errorMessage,
	onRetry,
	prefersReducedMotion,
	retryLabel,
}: {
	errorMessage: string;
	onRetry: () => void;
	prefersReducedMotion: boolean | null;
	retryLabel: string;
}) {
	return (
		<div
			role="alert"
			className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl bg-red-500/10 px-24 text-center text-xl text-red-500 text-balance"
		>
			<motion.div
				className="flex flex-col items-center gap-4"
				initial={{ opacity: 0, y: -100 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: 100 }}
				transition={
					prefersReducedMotion ? { duration: 0 } : { delay: 0.5 }
				}
			>
				<HugeiconsIcon icon={AlertCircleIcon} className="size-32 opacity-50" />
				<p>{errorMessage}</p>
				<Button
					size="sm"
					variant="transparent"
					className="rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/15"
					onPress={onRetry}
				>
					{retryLabel}
				</Button>
			</motion.div>
		</div>
	);
}

function GeneratedContent({
	content,
	errorMessage,
	isAnimating,
	isLoaded,
	onRetry,
	pdfSources,
	prefersReducedMotion,
	selectedId,
	showError,
	stickToBottom,
	jumpToLatestLabel,
	retryLabel,
}: GenerativeContentView & {
	jumpToLatestLabel: string;
	prefersReducedMotion: boolean | null;
	retryLabel: string;
}) {
	const { contentRef, isAtBottom, scrollRef, scrollToBottom } = stickToBottom;

	return (
		<div className="w-full h-full relative overflow-hidden">
			<div
				key={selectedId}
				ref={scrollRef}
				className="absolute inset-0 h-full w-full overflow-y-auto overflow-x-hidden rounded-br-xl bg-white dark:bg-secondary"
			>
				<div
					ref={contentRef}
					className="flex min-h-full w-full flex-col"
				>
					<Skeleton
						isLoaded={isLoaded}
						className="relative w-full flex-1 rounded-br-xl"
					>
						{showError ? (
							<GenerationError
								errorMessage={errorMessage}
								onRetry={onRetry}
								prefersReducedMotion={prefersReducedMotion}
								retryLabel={retryLabel}
							/>
						) : (
							<AIMarkdown
								className="prose dark:prose-invert space-y-2 max-w-full p-6"
								pdfSources={pdfSources}
								isAnimating={isAnimating}
							>
								{content}
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
					aria-label={jumpToLatestLabel}
					onPress={() => void scrollToBottom()}
				>
					<HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
				</Button>
			)}
		</div>
	);
}

export default function GenerativeModalView({
	content,
	history,
	isDesktop,
	isHistoryOpen,
	isOpen,
	onHistoryOpenChange,
	onOpenChange,
	prefersReducedMotion,
	labels,
	title,
}: {
	content: GenerativeContentView;
	history: GenerativeHistoryView;
	isDesktop: boolean;
	isHistoryOpen: boolean;
	isOpen: boolean;
	onHistoryOpenChange: (open: boolean) => void;
	onOpenChange: () => void;
	prefersReducedMotion: boolean | null;
	labels: {
		delete: string;
		deleteAriaLabel: string;
		history: string;
		jumpToLatest: string;
		retry: string;
	};
	title: string;
}) {
	const panelDuration = prefersReducedMotion ? 0 : 0.2;

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
										transition={{
											type: "tween",
											duration: panelDuration,
										}}
										className="col-span-3 w-full h-full overflow-y-hidden"
									>
										<HistoryPanel
											{...history}
											onSelect={(id) => {
												history.onSelect(id);
												onHistoryOpenChange(false);
											}}
										/>
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
											duration: panelDuration,
										}}
										className="w-full col-span-9 flex flex-col h-full overflow-y-hidden"
									>
										<ContentToolbar
											content={content.content}
											pdfSources={content.pdfSources}
											deleteDisabled={
												history.deleteDisabled
											}
											format={history.format}
											onDelete={history.onDelete}
											onHistoryOpen={() =>
												onHistoryOpenChange(true)
											}
											selectedItem={history.selectedItem}
											deleteAriaLabel={
												labels.deleteAriaLabel
											}
											deleteLabel={labels.delete}
											historyLabel={labels.history}
										/>
										<GeneratedContent
											{...content}
											prefersReducedMotion={
												prefersReducedMotion
											}
											jumpToLatestLabel={
												labels.jumpToLatest
											}
											retryLabel={labels.retry}
										/>
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
