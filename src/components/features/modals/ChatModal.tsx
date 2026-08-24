"use client";

import { ModalBody, ModalContent, Spinner } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import React, { useMemo } from "react";
import { IoChevronDown } from "react-icons/io5";
import { LuCheck, LuHash, LuType, LuUser, LuX } from "react-icons/lu";
import { PiXBold } from "react-icons/pi";
import { RiResetLeftFill } from "react-icons/ri";
import { twMerge } from "tailwind-merge";
import { isReasoningUIPart, isTextUIPart, isToolUIPart } from "ai";

import { PoweredByOpenScholar } from "@/components/features/ai/PoweredByOpenScholar";
import { SmartScreeningModal } from "@/components/features/ai/SmartScreeningModal";
import { Logo } from "@/components/layout/navbar/Logo";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Textarea } from "@/components/nextui/Textarea";
import { getAIModelPresentation } from "@/constants/ai";
import type { ItemGetResponse } from "@/app/api/item/types";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import { createTextMessage } from "@/lib/ai/chat-messages";
import { uiMessageText } from "@/lib/ai/client";
import type { AIModelId } from "@/lib/ai/models";
import {
	isScreeningResultsData,
	screeningExportContent,
	type ScreeningResultsData,
} from "@/lib/ai/screening-export";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";
import { ChatComposerControls, ChatComposerShell } from "../ai/ChatComposerControls";
import { ChatErrorCard } from "../ai/chat-shared";
import { useChatFailure, useMessageExport } from "../ai/useChatActions";
import { ToolActivity } from "../ai/ToolActivity";
import { useChatWindow } from "../ai/useChatWindow";
import Resource from "../items/Resource";
import { AIMarkdown } from "../markdown/Markdown";
import {
	AIGeneratedContentControls,
	AIStructuredContentControls,
	type ControlAction,
	type GeneratedContent,
} from "./AIControls";

type ChatWindowState = ReturnType<typeof useChatWindow>;
type Message = ResearchUIMessage;
type VisibleMessagePart = {
	key: string;
	part: Message["parts"][number];
};

function parseScreeningResults(messageId: string, content: string) {
	if (!messageId.startsWith("screening-")) return null;
	try {
		const parsed: unknown = JSON.parse(content);
		return isScreeningResultsData(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function visibleMessageParts(message: Message): VisibleMessagePart[] {
	let reasoningCount = 0;
	let textCount = 0;

	return message.parts.reduce<VisibleMessagePart[]>((parts, part) => {
		if (isReasoningUIPart(part) && part.text.trim()) {
			reasoningCount += 1;
			parts.push({ key: `reasoning-${reasoningCount}`, part });
		}

		if (isToolUIPart(part)) {
			parts.push({ key: `tool-${part.toolCallId}`, part });
		}

		if (isTextUIPart(part) && part.text.trim()) {
			textCount += 1;
			parts.push({ key: `text-${textCount}`, part });
		}

		return parts;
	}, []);
}

function ScreeningResults({ results }: { results: ScreeningResultsData }) {
	const tUI = useTranslations("ui");
	const resultEntries = Object.entries(results.result);
	const formats = useMemo(() => {
		const generated = screeningExportContent(
			results,
			typeof window === "undefined" ? undefined : window.location.origin,
		);
		return {
			plaintext: {
				content: generated.plaintext,
				extension: "txt",
				mimeType: "text/plain;charset=utf-8",
			},
			markdown: {
				content: generated.markdown,
				extension: "md",
				mimeType: "text/markdown;charset=utf-8",
			},
			html: {
				content: generated.html,
				extension: "html",
				mimeType: "text/html;charset=utf-8",
			},
			csv: {
				content: generated.csv,
				extension: "csv",
				mimeType: "text/csv;charset=utf-8",
			},
		} satisfies Record<ControlAction, GeneratedContent>;
	}, [results]);
	const exportControls = (
		<AIStructuredContentControls
			formats={formats}
			downloadName="smart-screening-results"
			appearance="header"
		/>
	);

	return (
		<div className="w-full space-y-4">
			<div className="flex flex-col gap-3 rounded-2xl bg-black/[0.025] p-3 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 px-1">
					<h2 className="text-lg font-medium text-black/80 dark:text-white/80">
						{tUI("smartScreening")}
					</h2>
					<p className="text-xs text-black/45 dark:text-white/45">
						{tUI.rich("resourcesCount", {
							count: resultEntries.length,
							number: (chunks) => chunks,
						})}
					</p>
				</div>
				<div className="flex items-center gap-1 self-end sm:self-auto">
					{exportControls}
				</div>
			</div>

			<div className="space-y-4">
				{resultEntries.map(([resourceId, value]) => (
					<article
						key={resourceId}
						className="overflow-hidden rounded-2xl bg-white/80 shadow-card-lifted dark:bg-white/[0.035]"
					>
						<Resource
							itemKey={resourceId}
							abstract={true}
							as="div"
							className="rounded-none bg-transparent dark:bg-transparent [&>div:last-child]:rounded-none"
						/>
						<div className="grid grid-cols-1 gap-3 bg-black/[0.025] p-3 dark:bg-black/[0.15] sm:p-4 md:grid-cols-2">
							{results.fields.map((field, fieldIndex) => {
								const fieldValue =
									value.screeningFields[field.label] ?? null;
								const isBoolean = field.type === "boolean";
								const fieldIcon =
									field.type === "number" ? (
										<LuHash />
									) : field.type === "string" ? (
										<LuType />
									) : fieldValue === true ? (
										<LuCheck />
									) : (
										<LuX />
									);

								return (
									<section
										key={field.label}
										className={twMerge(
											"min-w-0 rounded-xl bg-white/80 p-4 shadow-card-hairline dark:bg-white/[0.045] dark:shadow-none",
											results.fields.length % 2 === 1 &&
												fieldIndex ===
													results.fields.length - 1 &&
												"md:col-span-2",
										)}
									>
										<div className="flex items-start justify-between gap-3">
											<h3 className="min-w-0 text-xs font-medium leading-5 text-black/50 dark:text-white/50">
												{field.label}
											</h3>
											<span
												className={twMerge(
													"grid size-7 shrink-0 place-items-center rounded-lg bg-black/[0.045] text-sm text-black/40 dark:bg-white/[0.06] dark:text-white/40",
													isBoolean &&
														fieldValue === true &&
														"bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent",
												)}
												title={field.type}
												role="img"
												aria-label={field.type}
											>
												{fieldIcon}
											</span>
										</div>
										<p
											className={twMerge(
												"mt-2 break-words text-base font-medium leading-6 text-black/80 dark:text-white/80",
												isBoolean &&
													fieldValue === true &&
													"text-accent dark:text-accent",
											)}
										>
											{String(fieldValue)}
										</p>
									</section>
								);
							})}
						</div>
					</article>
				))}
			</div>

			<div className="flex justify-end rounded-2xl bg-black/[0.025] p-1 dark:bg-white/[0.04]">
				<div className="flex items-center gap-1">{exportControls}</div>
			</div>
		</div>
	);
}

function MessageComponent({
	message,
	modelId,
	error,
	pdfSources,
	isStreaming,
}: {
	message: Message;
	modelId: AIModelId;
	error: boolean;
	pdfSources: Record<string, string>;
	isStreaming: boolean;
}) {
	const content = uiMessageText(message);
	const visibleParts = visibleMessageParts(message);
	const screeningResults = useMemo(
		() => parseScreeningResults(message.id, content),
		[content, message.id],
	);
	const hasFinalAnswer = message.parts.some(
		(part) => isTextUIPart(part) && part.text.trim(),
	);
	const showMessageActions =
		message.role === "assistant" &&
		!isStreaming &&
		!error &&
		!screeningResults &&
		!message.id.includes("error") &&
		hasFinalAnswer;
	const getMessageContent = useMessageExport(message);

	return (
		<>
			<div
				className={twMerge(
					"rounded-full bg-accent dark:bg-accent p-2",
					message.role !== "user" && "hidden",
				)}
			>
				{message.role === "user" ? (
					<LuUser className="size-4 text-white" />
				) : (
					React.createElement(getAIModelPresentation(modelId).icon, {
						className: "size-4 invert shrink-0",
					})
				)}
			</div>
			<div
				className={twMerge(
					"p-0 text-wrap max-w-full overflow-hidden break-words text-lg",
					message.role === "user" &&
						"bg-white dark:bg-secondary rounded-xl",
					message.role !== "user" && "w-full",
					message.id.includes("error") &&
						"text-red-500 dark:text-red-500 italic",
				)}
			>
				{visibleParts.length === 0 && !error ? (
					<div className="flex items-center gap-3 p-4">
						<div className="flex w-fit items-center justify-center rounded-full bg-black p-2 opacity-60">
							<Spinner />
						</div>
					</div>
				) : (
					<>
						{screeningResults ? (
							<ScreeningResults results={screeningResults} />
						) : message.role === "assistant" ? (
							visibleParts.map(({ key, part }, partIndex) => {
								const isLastPart =
									partIndex === visibleParts.length - 1;

								if (
									isReasoningUIPart(part) &&
									part.text.trim()
								) {
									return (
										<div key={key} className="mt-4">
											<AIMarkdown
												pdfSources={pdfSources}
												isAnimating={
													isStreaming && isLastPart
												}
												className="prose prose-sm max-w-full text-black/50 dark:prose-invert dark:text-white/50 [&_p]:my-1.5 [&_strong]:font-medium [&_strong]:text-black/60 dark:[&_strong]:text-white/60"
											>
												{part.text}
											</AIMarkdown>
										</div>
									);
								}

								if (isToolUIPart(part)) {
									return (
										<div key={key} className="mt-2">
											<ToolActivity part={part} />
										</div>
									);
								}

								if (isTextUIPart(part) && part.text.trim()) {
									return (
										<AIMarkdown
											key={key}
											pdfSources={pdfSources}
											isAnimating={
												isStreaming && isLastPart
											}
											className="mt-6 w-full max-w-full space-y-4 p-0 prose dark:prose-invert"
										>
											{part.text}
										</AIMarkdown>
									);
								}

								return null;
							})
						) : content.trim() ? (
							<AIMarkdown
								pdfSources={pdfSources}
								isAnimating={isStreaming}
								className="w-full max-w-full space-y-4 p-4 prose dark:prose-invert"
							>
								{content}
							</AIMarkdown>
						) : null}
						{showMessageActions && (
							<div className="mt-3 flex items-center gap-0.5">
								<AIGeneratedContentControls
									getContent={getMessageContent}
									downloadName="ai-response"
									appearance="inline"
								/>
							</div>
						)}
					</>
				)}
			</div>
		</>
	);
}

type ChatMessageListProps = {
	chatFailure: ReturnType<typeof useChatFailure>;
	contentRef: (element: HTMLDivElement | null) => void;
	hasError: boolean;
	isAtBottom: boolean;
	isStreaming: boolean;
	messages: Message[];
	modelId: AIModelId;
	onReset: () => void;
	onRetry: () => void;
	pdfSources: Record<string, string>;
	scrollEdges: { top: boolean; bottom: boolean };
	scrollRef: (element: HTMLDivElement | null) => void;
	scrollToBottom: () => void;
};

/** One message, sliding in from the side that sent it. */
function ChatMessageRow({
	hasError,
	isStreaming,
	message,
	modelId,
	pdfSources,
}: {
	hasError: boolean;
	isStreaming: boolean;
	message: Message;
	modelId: AIModelId;
	pdfSources: Record<string, string>;
}) {
	const fromReader = message.role === "user";

	return (
		<motion.div
			initial={{ x: fromReader ? 100 : -100, opacity: 0 }}
			animate={{ x: 0, opacity: 1 }}
			transition={{ type: "spring", stiffness: 260, damping: 20 }}
			className={twMerge(
				"flex items-start justify-start gap-2 w-full",
				fromReader && "flex-row-reverse",
			)}
		>
			<MessageComponent
				message={message}
				modelId={modelId}
				error={hasError}
				pdfSources={pdfSources}
				isStreaming={isStreaming}
			/>
		</motion.div>
	);
}

/** An empty reply bubble, shown while the assistant is still thinking. */
function PendingReply({
	modelId,
	pdfSources,
}: {
	modelId: AIModelId;
	pdfSources: Record<string, string>;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, x: -40 }}
			animate={{ opacity: 1, x: 0 }}
			className="flex w-full items-start justify-start gap-2"
		>
			<MessageComponent
				message={createTextMessage("assistant", "", "pending-assistant")}
				modelId={modelId}
				error={false}
				pdfSources={pdfSources}
				isStreaming={false}
			/>
		</motion.div>
	);
}

/** Fades the conversation out where it runs past the top or bottom edge. */
function ScrollEdgeFade({
	atTop,
	isVisible,
}: {
	atTop?: boolean;
	isVisible: boolean;
}) {
	return (
		<div
			aria-hidden
			className={twMerge(
				"pointer-events-none absolute inset-x-0 z-10 bg-gradient-to-b from-background_light via-background_light/75 to-transparent transition-opacity duration-300 ease-out dark:from-card dark:via-card/75",
				atTop ? "top-0 h-28" : "bottom-0 h-20 rotate-180",
				isVisible ? "opacity-100" : "opacity-0",
			)}
		/>
	);
}

/** The conversation itself, with its scroll behaviour and failure alert. */
function ChatMessageList({
	chatFailure,
	contentRef,
	hasError,
	isAtBottom,
	isStreaming,
	messages,
	modelId,
	onReset,
	onRetry,
	pdfSources,
	scrollEdges,
	scrollRef,
	scrollToBottom,
}: ChatMessageListProps) {
	const t = useTranslations("ai");
	const lastIndex = messages.length - 1;
	const isWaitingForReply = isStreaming && messages.at(-1)?.role === "user";

	return (
		<motion.div
			layoutId="chat-messages"
			layout="position"
			transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
			className="relative h-full min-h-0 min-w-0 w-full overflow-hidden"
		>
			<div
				ref={scrollRef}
				className="no-scrollbar h-full w-full overflow-y-auto overflow-x-hidden"
			>
				<div
					ref={contentRef}
					className="mx-auto flex min-h-full max-w-chat flex-col gap-8 pb-8 pt-28 lg:px-24"
				>
					{/* The greeting is the window's own text, not part of
					    the conversation, so it is drawn elsewhere. */}
					{messages.slice(1).map((message, index) => (
						<ChatMessageRow
							key={message.id}
							hasError={hasError}
							isStreaming={
								isStreaming &&
								index + 1 === lastIndex &&
								message.role === "assistant"
							}
							message={message}
							modelId={modelId}
							pdfSources={pdfSources}
						/>
					))}
					{isWaitingForReply ? (
						<PendingReply
							modelId={modelId}
							pdfSources={pdfSources}
						/>
					) : null}
					{chatFailure.hasFailed ? (
						<motion.div
							initial={{ opacity: 0, y: 16, scale: 0.97 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: 16, scale: 0.97 }}
							transition={{
								type: "spring",
								bounce: 0.3,
								duration: 0.5,
							}}
							className="flex w-full justify-center px-4"
						>
							<ChatErrorCard
								message={chatFailure.message}
								isContextTooLarge={chatFailure.isContextTooLarge}
								onReset={onReset}
								onRetry={onRetry}
								className="max-w-xl"
							/>
						</motion.div>
					) : null}
				</div>
			</div>
			<ScrollEdgeFade atTop isVisible={scrollEdges.top} />
			<ScrollEdgeFade isVisible={scrollEdges.bottom} />
			{isAtBottom ? null : (
				<Button
					isIconOnly
					size="sm"
					className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
					aria-label={t("jumpToLatest")}
					onPress={() => scrollToBottom()}
				>
					<IoChevronDown className="size-4" />
				</Button>
			)}
		</motion.div>
	);
}

type ChatWindowComposerProps = {
	chat: ChatWindowState;
	hasPublication: boolean;
	onHeightChange: () => void;
	onScreen: () => void;
	questions?: string[];
};

/** The suggested questions shown before the conversation starts. */
function StarterQuestions({
	onPick,
	questions,
}: {
	onPick: (question: string) => void;
	questions: string[];
}) {
	return (
		<motion.ul
			key="questions"
			initial={{ opacity: 0, y: 100 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -100 }}
			className="w-full flex flex-col lg:flex-row gap-4 max-w-chat lg:px-14 mx-auto"
		>
			{questions.map((question) => (
				<li key={question}>
					<Button
						className="text-wrap p-4 bg-transparent dark:bg-transparent min-h-fit h-full"
						size="sm"
						onClick={() => {
							onPick(question);
						}}
					>
						{question}
					</Button>
				</li>
			))}
		</motion.ul>
	);
}

/** The message box itself. Enter sends, Shift+Enter starts a new line. */
function ChatMessageBox({
	hasPublication,
	input,
	onHeightChange,
	onSubmit,
	setInput,
}: {
	hasPublication: boolean;
	input: string;
	onHeightChange: () => void;
	onSubmit: (event: React.FormEvent) => void;
	setInput: (input: string) => void;
}) {
	const t = useTranslations("ai");
	const sendsOnEnter = (event: React.KeyboardEvent) =>
		event.key === "Enter" &&
		!event.shiftKey &&
		!(event.nativeEvent as KeyboardEvent).isComposing;

	return (
		<Textarea
			minRows={1}
			// The composer resizes the message viewport above it; re-pin
			// through the hook so it isn't mistaken for the user scrolling up.
			onHeightChange={onHeightChange}
			onKeyDown={(event) => {
				if (!sendsOnEnter(event)) return;
				event.preventDefault();
				onSubmit(event);
			}}
			autoFocus
			autoComplete="off"
			aria-label={t("askAI")}
			placeholder={t(
				hasPublication ? "askMeAnything" : "askMeAnythingPublications",
			)}
			value={input}
			onValueChange={setInput}
			classNames={{
				base: "w-full min-w-0",
				inputWrapper:
					"min-h-14 !rounded-2xl !border-0 !bg-transparent !px-2 !py-1 !shadow-none group-data-[focus=true]:!bg-transparent group-data-[hover=true]:!bg-transparent data-[focus=true]:!outline-none dark:!bg-transparent",
				input: "text-base leading-6",
			}}
		/>
	);
}

/** The hairline that lights up while the composer is in use. */
function ComposerHairline({
	isLit,
	prefersReducedMotion,
}: {
	isLit: boolean;
	prefersReducedMotion: boolean | null;
}) {
	return (
		<motion.div
			aria-hidden="true"
			initial={false}
			animate={{ opacity: isLit ? 1 : 0, scaleX: isLit ? 1 : 0.35 }}
			transition={{
				duration: prefersReducedMotion ? 0 : 0.24,
				ease: [0.22, 1, 0.36, 1],
			}}
			className="pointer-events-none absolute inset-x-8 top-0 h-px origin-center bg-gradient-to-r from-transparent via-accent to-transparent"
		/>
	);
}

/** Starter questions, the message box, and the controls under it. */
function ChatWindowComposer({
	chat,
	hasPublication,
	onHeightChange,
	onScreen,
	questions,
}: ChatWindowComposerProps) {
	const {
		canRunScreening,
		conversationStarted,
		handleSubmit,
		input,
		isComposerFocused,
		isDeepResearchEnabled,
		isInputReady,
		isMutating,
		isWaiting,
		mode,
		onSmartScreeningOpen,
		prefersReducedMotion,
		screeningTooltip,
		setInput,
		setIsComposerFocused,
		setMode,
	} = chat;
	const showQuestions = !isWaiting && !conversationStarted;

	return (
		<form
			className="relative flex min-w-0 w-full flex-col gap-4 p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] sm:gap-8 sm:p-8"
			onSubmit={handleSubmit}
		>
			<AnimatePresence mode="popLayout">
				{showQuestions && questions ? (
					<StarterQuestions
						onPick={setInput}
						questions={questions}
					/>
				) : null}
				<ChatComposerShell
					className="mx-auto max-w-3xl rounded-3xl p-2 dark:bg-card"
					isComposerFocused={isComposerFocused}
					isWaiting={isWaiting}
					prefersReducedMotion={prefersReducedMotion}
					setComposerFocused={setIsComposerFocused}
				>
					<ComposerHairline
						isLit={isComposerFocused || isWaiting}
						prefersReducedMotion={prefersReducedMotion}
					/>
					<ChatMessageBox
						hasPublication={hasPublication}
						input={input}
						onHeightChange={onHeightChange}
						onSubmit={handleSubmit}
						setInput={setInput}
					/>
					<ChatComposerControls
						canScreen={canRunScreening}
						isDeepResearchEnabled={isDeepResearchEnabled}
						isInputReady={isInputReady}
						isScreening={isMutating}
						isWaiting={isWaiting}
						mode={mode}
						onModeChange={setMode}
						onScreen={onScreen}
						onScreeningSettings={onSmartScreeningOpen}
						prefersReducedMotion={prefersReducedMotion}
						screeningTooltip={screeningTooltip}
					/>
				</ChatComposerShell>
			</AnimatePresence>
		</form>
	);
}

/** The window's own controls: reset, export, and close. */
function ChatWindowTopBar({
	conversationStarted,
	getTranscriptContent,
	isWaiting,
	onClose,
	onReset,
}: {
	conversationStarted: boolean;
	getTranscriptContent: (action: ControlAction) => Promise<GeneratedContent>;
	isWaiting: boolean;
	onClose: () => void;
	onReset: () => void;
}) {
	const tUI = useTranslations("ui");

	return (
		<>
			{/* Institution branding: the navbar's logo, including its home
			    link. OpenScholar is credited under the composer. */}
			<div className="pointer-events-none absolute left-4 top-4 z-30 flex h-12 items-center sm:left-6 sm:top-5 [&_img]:max-h-10 [&_img]:w-auto">
				<div className="pointer-events-auto">
					<Logo />
				</div>
			</div>
			<div className="pointer-events-none absolute right-4 top-4 z-30 flex items-center gap-2 sm:right-6 sm:top-5">
				<div className="pointer-events-auto flex h-10 items-center gap-0.5 rounded-full border border-black/[0.08] bg-white p-1 shadow-card-flat dark:border-white/10 dark:bg-secondary-400 dark:shadow-none">
					<Button
						startContent={<RiResetLeftFill />}
						variant="transparent"
						size="sm"
						className="h-8 min-w-0 gap-1.5 rounded-2xl px-2.5 text-sm text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.06] data-[disabled=true]:bg-transparent"
						aria-label={tUI("resetAriaLabel")}
						isDisabled={isWaiting}
						onClick={onReset}
					>
						<span className="hidden lg:block">
							{tUI("resetChat")}
						</span>
					</Button>
					<AIGeneratedContentControls
						getContent={getTranscriptContent}
						downloadName="chat-transcript"
						isDisabled={!conversationStarted || isWaiting}
						appearance="header"
					/>
				</div>
				<Button
					onPress={onClose}
					isIconOnly
					variant="transparent"
					className="pointer-events-auto size-10 rounded-full border border-black/[0.08] bg-white text-black/55 shadow-card-flat hover:bg-black/[0.035] hover:text-black/75 dark:border-white/10 dark:bg-secondary-400 dark:text-white/55 dark:shadow-none dark:hover:bg-white/[0.06] dark:hover:text-white/75"
					aria-label={tUI("closePopupAriaLabel")}
				>
					<PiXBold className="size-4" />
				</Button>
			</div>
		</>
	);
}

export default function ChatModal({
	isOpen,
	onOpenChange,
	data,
	modelId,
	questions,
	externalInput,
	setExternalInput,
	searchContext,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	data?: ItemGetResponse | undefined;
	modelId: AIModelId;
	questions?: undefined | string[];
	externalInput?: string;
	setExternalInput?: (input: string) => void;
	searchContext?: LibrarySearchContext;
}) {
	const chat = useChatWindow({
		data,
		externalInput,
		isOpen,
		modelId,
		searchContext,
		setExternalInput,
	});
	const {
		canRunScreening,
		chatFailure,
		contentRef,
		conversationStarted,
		error,
		getTranscriptContent,
		handleScreening,
		handleSubmit,
		input,
		isAtBottom,
		isComposerFocused,
		isDeepResearchEnabled,
		isInputReady,
		isMutating,
		isSmartScreeningOpen,
		isWaiting,
		messages,
		messagesScrollRef,
		mode,
		onSmartScreeningOpen,
		onSmartScreeningOpenChange,
		pdfSources,
		prefersReducedMotion,
		reload,
		resetChat,
		screenableContent,
		screeningTooltip,
		scrollEdges,
		scrollToBottom,
		setInput,
		setIsComposerFocused,
		setMode,
		status,
	} = chat;

	return (
		<>
			{isSmartScreeningOpen && (
				<SmartScreeningModal
					isOpen
					onOpenChange={onSmartScreeningOpenChange}
				/>
			)}
			<DialogModal
				size="full"
				scrollBehavior="inside"
				hideCloseButton
				isDismissable={false}
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				classNames={{
					base: "m-0 h-dvh min-h-dvh max-h-dvh w-screen max-w-none rounded-none border-none dark:border-none",
					wrapper: "overflow-hidden p-0",
				}}
			>
				<ModalContent className="relative h-full min-h-0 overflow-hidden">
					{(onClose) => (
						<>
							{/* Institution branding: the navbar's logo, including its
							    home link. OpenScholar is credited under the composer. */}
							<ChatWindowTopBar
								conversationStarted={conversationStarted}
								getTranscriptContent={getTranscriptContent}
								isWaiting={isWaiting}
								onClose={onClose}
								onReset={resetChat}
							/>
							<ModalBody className="min-h-0 w-full overflow-hidden p-0">
								<div
									className={twMerge(
										"relative h-full min-h-0 min-w-0 w-full",
										conversationStarted
											? "grid grid-rows-chat"
											: "flex justify-center items-center",
									)}
								>
									{conversationStarted && (
										<ChatMessageList
											chatFailure={chatFailure}
											contentRef={contentRef}
											isAtBottom={isAtBottom}
											isStreaming={status === "streaming"}
											hasError={Boolean(error)}
											messages={messages}
											modelId={modelId}
											onReset={resetChat}
											onRetry={reload}
											pdfSources={pdfSources}
											scrollEdges={scrollEdges}
											scrollRef={messagesScrollRef}
											scrollToBottom={scrollToBottom}
										/>
									)}
									<motion.div
										layoutId="chat-input"
										layout="position"
										transition={{
											type: "spring",
											bounce: 0.25,
											duration: 0.5,
										}}
										className="relative flex min-w-0 w-full flex-col items-center"
									>
										<AnimatePresence>
											{conversationStarted &&
												isWaiting && (
													<motion.div
														aria-hidden="true"
														initial={{ opacity: 0 }}
														animate={{ opacity: 1 }}
														exit={{ opacity: 0 }}
														transition={{
															duration:
																prefersReducedMotion
																	? 0
																	: 0.2,
														}}
														className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px overflow-hidden"
													>
														<div className="h-full w-full animate-gradient-x bg-gradient-to-r from-transparent via-accent/35 to-transparent bg-shimmer motion-reduce:animate-none motion-reduce:bg-accent/20" />
													</motion.div>
												)}
										</AnimatePresence>
										<ChatWindowComposer
											chat={chat}
											hasPublication={Boolean(
												data?.item?.title,
											)}
											onHeightChange={() => {
												if (!isAtBottom) return;
												void scrollToBottom({
													animation: "instant",
												});
											}}
											onScreen={() =>
												void handleScreening(
													screenableContent,
												)
											}
											questions={questions}
										/>
										{/* Pulled up into the form's bottom padding; the form is
										    position:relative, so this needs its own stacking
										    context or the form swallows the clicks. */}
										<div className="relative z-10 -mt-1 flex w-full justify-center pb-3 sm:-mt-4 sm:pb-4">
											<PoweredByOpenScholar />
										</div>
									</motion.div>
								</div>
							</ModalBody>
						</>
					)}
				</ModalContent>
			</DialogModal>
		</>
	);
}
