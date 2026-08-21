"use client";

import { Button } from "@/components/nextui/Button";
import { Logo } from "@/components/layout/navbar/Logo";
import { PoweredByOpenScholar } from "@/components/features/ai/PoweredByOpenScholar";
import {
	ModalContent,
	ModalBody,
	ButtonGroup,
	Spinner,
	useDisclosure,
} from "@nextui-org/react";
import { LuCheck, LuHash, LuType, LuUser, LuX } from "react-icons/lu";
import { twMerge } from "tailwind-merge";
import { ImSpinner8 } from "react-icons/im";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { IoChevronDown } from "react-icons/io5";
import { useLocale, useTranslations } from "next-intl";
import { useChat } from "@ai-sdk/react";
import {
	DefaultChatTransport,
	isReasoningUIPart,
	isTextUIPart,
	isToolUIPart,
} from "ai";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import type { AIModelId } from "@/lib/ai/models";

export type Message = ResearchUIMessage;
type VisibleMessagePart = {
	key: string;
	part: Message["parts"][number];
};

export function createTextMessage(
	role: "user" | "assistant",
	content: string,
	id: string,
): Message {
	return {
		id,
		role,
		parts: [{ type: "text", text: content }],
	} as Message;
}

function withLatestRequestContext(
	messages: Message[],
	context: ReturnType<typeof createResearchRequestContextSnapshot>,
) {
	if (
		researchRequestContextsEqual(
			latestResearchRequestContext(messages),
			context,
		)
	) {
		return messages;
	}

	const messageIndex = messages.findLastIndex(
		({ role }) => role === "user",
	);
	if (messageIndex < 0) return messages;

	const updated = [...messages];
	updated[messageIndex] = {
		...updated[messageIndex],
		parts: [
			...updated[messageIndex].parts,
			researchRequestContextPart(context),
		],
	};
	return updated;
}
import { getAIModelForUI } from "@/constants/ai";
import { AIMarkdown } from "../markdown/Markdown";
import posthog from "posthog-js";
import DialogModal from "@/components/nextui/DialogModal";
import { Textarea } from "@/components/nextui/Textarea";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { RiResetLeftFill } from "react-icons/ri";
import { useLocalStorage } from "usehooks-ts";
import {
	SmartScreeningModal,
	type SmartScreeningField,
	useIsAISearchEnabled,
} from "@/components/pages/EvidenceLibrary";
import Resource from "../items/Resource";
import { Tooltip } from "@/components/nextui/Tooltip";
import { publicationPdfCitationSources } from "@/lib/ai/citations";
import { clientAIError, uiMessageText } from "@/lib/ai/client";
import { AI_CONTEXT_TOO_LARGE_MESSAGE } from "@/lib/ai/error-message";
import type { LibrarySearchContext } from "@/lib/search-context";
import {
	createResearchRequestContextSnapshot,
	latestResearchRequestContext,
	researchRequestContextsEqual,
	researchRequestContextPart,
} from "@/lib/ai/request-context";
import { useStickToBottom } from "use-stick-to-bottom";
import { ChatErrorCard, useScrollEdges } from "../ai/chat-shared";
import { ToolActivity } from "../ai/ToolActivity";
import {
	AIGeneratedContentControls,
	AIStructuredContentControls,
	type ControlAction,
	type GeneratedContent,
} from "./AIControls";
import {
	isScreeningResultsData,
	screeningExportContent,
	type ScreeningResultsData,
} from "@/lib/ai/screening-export";
import {
	CHAT_EXPORT_OUTPUT,
	chatMessageContent,
	chatTranscriptContent,
	type ChatTranscriptFormat,
} from "@/lib/ai/transcript-export";
import {
	PiBinocularsBold,
	PiGearSixBold,
	PiPaperPlaneTiltFill,
	PiPlayFill,
	PiXBold,
} from "react-icons/pi";

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
						className="overflow-hidden rounded-2xl bg-white/80 shadow-[0_14px_36px_-30px_rgba(0,0,0,0.45)] dark:bg-white/[0.035]"
					>
						<Resource
							itemKey={resourceId}
							abstract={true}
							as="div"
							openLinksInNewTab
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
											"min-w-0 rounded-xl bg-white/80 p-4 shadow-[0_1px_0_rgba(0,0,0,0.035)] dark:bg-white/[0.045] dark:shadow-none",
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

export function MessageComponent({
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
	const getMessageContent = useCallback(
		async (action: ControlAction): Promise<GeneratedContent> => {
			if (action === "csv") {
				throw new Error("CSV is not available for chat messages.");
			}
			const format = action satisfies ChatTranscriptFormat;
			const exported = await chatMessageContent(
				format,
				message,
				window.location.origin,
			);
			return { content: exported, ...CHAT_EXPORT_OUTPUT[format] };
		},
		[message],
	);

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
					React.createElement(getAIModelForUI(modelId).icon, {
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

export type ChatMode = "research" | "quick";

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
	const pdfSources = useMemo(
		() =>
			publicationPdfCitationSources(
				data?.item?.key,
				data?.item?.attachmentsData,
			),
		[data?.item?.key, data?.item?.attachmentsData],
	);
	const [smartScreeningFields] = useLocalStorage<SmartScreeningField[]>(
		"smart-screening-fields",
		[],
	);
	const {
		isOpen: isSmartScreeningOpen,
		onOpen: onSmartScreeningOpen,
		onOpenChange: onSmartScreeningOpenChange,
	} = useDisclosure();
	const { isDeepResearchEnabled } = useIsAISearchEnabled();
	const [internalMode, setMode] = useLocalStorage<ChatMode>(
		"chat-mode",
		"quick",
	);
	const mode: ChatMode = isDeepResearchEnabled ? internalMode : "quick";

	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const locale = useLocale();
	const prefersReducedMotion = useReducedMotion();
	const [input, setInput] = useState("");
	const [isComposerFocused, setIsComposerFocused] = useState(false);
	const {
		messages,
		sendMessage,
		error,
		status,
		regenerate,
		setMessages,
		clearError,
	} = useChat<ResearchUIMessage>({
		throttle: 50,
		transport: new DefaultChatTransport({
			api: "/api/ai/chat",
			headers: {
				"Accept-Language": locale,
			},
			body: () => ({
				itemKey: data?.item?.key,
				modelId,
				distinctId: posthog.get_distinct_id(),
				mode,
				searchContext,
			}),
		}),
		messages: [
			createTextMessage(
				"assistant",
				t("chatPlaceholder", { title: data?.item?.title || "" }),
				"start",
			),
		],
	});
	const currentRequestContext = useCallback(
		() =>
			createResearchRequestContextSnapshot({
				currentPublication: data?.item?.key
					? {
							key: data.item.key,
							title:
								data.item.title || "Untitled publication",
						}
					: undefined,
				searchContext,
			}),
		[data?.item?.key, data?.item?.title, searchContext],
	);
	const sendMessageWithContext = useCallback(
		(text: string) => {
			const context = currentRequestContext();
			const parts: Message["parts"] = [];
			if (
				!researchRequestContextsEqual(
					latestResearchRequestContext(messages),
					context,
				)
			) {
				parts.push(researchRequestContextPart(context));
			}
			parts.push({ type: "text", text });
			return sendMessage({ parts });
		},
		[currentRequestContext, messages, sendMessage],
	);
	const resetChat = useCallback(() => {
		clearError();
		setMessages((currentMessages) => currentMessages.slice(0, 1));
	}, [clearError, setMessages]);

	const isLoading = status === "submitted" || status === "streaming";
	const isInputReady = input.trim().length > 0 && !isLoading;
	const reload = useCallback(() => {
		setMessages((currentMessages) =>
			withLatestRequestContext(
				currentMessages,
				currentRequestContext(),
			),
		);
		return regenerate();
	}, [currentRequestContext, regenerate, setMessages]);
	const [isMutating, setIsMutating] = useState(false);
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		// Ignore submits while a response is generating; the input keeps its
		// text so nothing is lost.
		if (isLoading || isMutating || !input.trim()) return;
		void sendMessageWithContext(input);
		setInput("");
	};

	const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
		useStickToBottom({
			initial: "smooth",
			resize: "smooth",
		});

	const appendMessage = (message: Message) => {
		setMessages((prevMessages) => [
			...prevMessages.filter(({ id }) => id !== message.id),
			message,
		]);
	};

	const conversationStarted = messages.length > 1;
	const { edges: scrollEdges, ref: scrollEdgesRef } = useScrollEdges();
	const messagesScrollRef = useCallback(
		(element: HTMLDivElement | null) => {
			scrollRef(element);
			scrollEdgesRef(element);
		},
		[scrollRef, scrollEdgesRef],
	);
	const screenableContent = useMemo(
		() =>
			messages
				.filter(
					(message) =>
						message.role === "assistant" &&
						!message.id.startsWith("screening-"),
				)
				.map(uiMessageText)
				.filter((content) => content.includes("/lib/"))
				.join("\n"),
		[messages],
	);
	const canRunScreening =
		smartScreeningFields.length > 0 && screenableContent.length > 0;

	useEffect(() => {
		if (externalInput && isOpen && !isLoading && !isMutating) {
			void sendMessageWithContext(externalInput);
			setExternalInput?.("");
		}
	}, [
		externalInput,
		isOpen,
		isLoading,
		isMutating,
		sendMessageWithContext,
		setExternalInput,
	]);

	const isWaitingForAssistant = isLoading && messages.at(-1)?.role === "user";

	const handleScreening = async (content: string) => {
		const keys = Array.from(
			content.matchAll(/\/lib\/([A-Za-z0-9:_-]+)/g),
			(match) => match[1],
		);
		if (!keys.length || smartScreeningFields.length === 0) {
			return;
		}
		const keysArray = [...new Set(keys)].slice(0, 25);
		setIsMutating(true);
		try {
			const response = await fetch("/api/ai/screen", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					keys: keysArray,
					modelId,
					fields: smartScreeningFields,
					distinctId: posthog.get_distinct_id(),
				}),
			});
			if (!response.ok) throw new Error(await response.text());
			const result = await response.json();
			if (Object.keys(result).length > 0) {
				appendMessage(
					createTextMessage(
						"assistant",
						JSON.stringify({
							result: result,
							fields: smartScreeningFields,
						}),
						"screening-result",
					),
				);
			} else {
				appendMessage(
					createTextMessage(
						"assistant",
						tUI("noResourcesForScreening"),
						"screening-result",
					),
				);
			}
		} catch (error) {
			console.error(error);
			const visibleError = clientAIError(
				error instanceof Error ? error : new Error(String(error)),
			);
			appendMessage(
				createTextMessage(
					"assistant",
					visibleError.message,
					"screening-error",
				),
			);
		} finally {
			setIsMutating(false);
		}
	};

	const isWaiting = (isLoading || isMutating) && !error;
	const getTranscriptContent = useCallback(
		async (action: ControlAction): Promise<GeneratedContent> => {
			if (action === "csv") {
				throw new Error("CSV is not available for chat transcripts.");
			}

			const format = action satisfies ChatTranscriptFormat;
			const content = await chatTranscriptContent(
				format,
				messages.slice(1),
				{
					title: t("askAI"),
					user: tUI("genericUser"),
					assistant: getAIModelForUI(modelId).name,
					reasoning: t("reasoning"),
					smartScreening: tUI("smartScreening"),
				},
				window.location.origin,
			);
			return { content, ...CHAT_EXPORT_OUTPUT[format] };
		},
		[messages, modelId, t, tUI],
	);
	const visibleChatError = error ? clientAIError(error) : undefined;
	const isContextTooLarge =
		visibleChatError?.message === AI_CONTEXT_TOO_LARGE_MESSAGE;
	const visibleChatErrorMessage =
		visibleChatError &&
		(visibleChatError.message.includes("RATE_LIMITED") ||
			visibleChatError.message.includes("Rate limit exceeded"))
			? t("rateLimitedMessage", { seconds: 60 })
			: visibleChatError?.message || t("errorMessage");

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
							<div className="pointer-events-none absolute left-4 top-4 z-30 flex h-12 items-center sm:left-6 sm:top-5 [&_img]:max-h-10 [&_img]:w-auto">
								<div className="pointer-events-auto">
									<Logo />
								</div>
							</div>
							<div className="pointer-events-none absolute right-4 top-4 z-30 flex items-center gap-2 sm:right-6 sm:top-5">
								<div className="pointer-events-auto flex h-10 items-center gap-0.5 rounded-full border border-black/[0.08] bg-white p-1 shadow-[0_4px_20px_rgba(0,0,0,0.04)] dark:border-white/10 dark:bg-secondary-400 dark:shadow-none">
									<Button
										startContent={<RiResetLeftFill />}
										variant="transparent"
										size="sm"
										className="h-8 min-w-0 gap-1.5 rounded-2xl px-2.5 text-sm text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.06] data-[disabled=true]:bg-transparent"
										aria-label={tUI("resetAriaLabel")}
										isDisabled={isWaiting}
										onClick={resetChat}
									>
										<span className="hidden lg:block">
											{tUI("resetChat")}
										</span>
									</Button>
									<AIGeneratedContentControls
										getContent={getTranscriptContent}
										downloadName="chat-transcript"
										isDisabled={
											!conversationStarted || isWaiting
										}
										appearance="header"
									/>
								</div>
								<Button
									onPress={onClose}
									isIconOnly
									variant="transparent"
									className="pointer-events-auto size-10 rounded-full border border-black/[0.08] bg-white text-black/55 shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:bg-black/[0.035] hover:text-black/75 dark:border-white/10 dark:bg-secondary-400 dark:text-white/55 dark:shadow-none dark:hover:bg-white/[0.06] dark:hover:text-white/75"
									aria-label={tUI("closePopupAriaLabel")}
								>
									<PiXBold className="size-4" />
								</Button>
							</div>
							<ModalBody className="min-h-0 w-full overflow-hidden p-0">
								<div
									className={twMerge(
										"relative h-full min-h-0 min-w-0 w-full",
										conversationStarted
											? "grid grid-rows-[minmax(0,1fr)_auto]"
											: "flex justify-center items-center",
									)}
								>
									{conversationStarted && (
										<motion.div
											layoutId="chat-messages"
											layout="position"
											transition={{
												type: "spring",
												bounce: 0.25,
												duration: 0.5,
											}}
											className="relative h-full min-h-0 min-w-0 w-full overflow-hidden"
										>
											<div
												ref={messagesScrollRef}
												className="no-scrollbar h-full w-full overflow-y-auto overflow-x-hidden"
											>
												<div
													ref={contentRef}
													className="mx-auto flex min-h-full max-w-[96rem] flex-col gap-8 pb-8 pt-28 lg:px-24"
												>
													{messages.map(
														(message, index) =>
															index > 0 && (
																<motion.div
																	initial={{
																		x:
																			message.role ===
																			"user"
																				? 100
																				: -100,
																		opacity: 0,
																	}}
																	animate={{
																		x: 0,
																		opacity: 1,
																	}}
																	transition={{
																		type: "spring",
																		stiffness: 260,
																		damping: 20,
																	}}
																	key={
																		message.id
																	}
																	className={twMerge(
																		"flex items-start justify-start gap-2 w-full",
																		message.role ===
																			"user" &&
																			"flex-row-reverse",
																	)}
																>
																	<MessageComponent
																		message={
																			message
																		}
																		modelId={
																			modelId
																		}
																		error={
																			!!error
																		}
																		pdfSources={
																			pdfSources
																		}

																		isStreaming={
																			status ===
																				"streaming" &&
																			index ===
																				messages.length -
																					1 &&
																			message.role ===
																				"assistant"
																		}
																	/>
																</motion.div>
															),
													)}
													{isWaitingForAssistant && (
														<motion.div
															initial={{
																opacity: 0,
																x: -40,
															}}
															animate={{
																opacity: 1,
																x: 0,
															}}
															className="flex w-full items-start justify-start gap-2"
														>
															<MessageComponent
																message={createTextMessage(
																	"assistant",
																	"",
																	"pending-assistant",
																)}
																modelId={
																	modelId
																}
																error={false}
																pdfSources={
																	pdfSources
																}
																isStreaming={
																	false
																}
															/>
														</motion.div>
													)}
													{visibleChatError && (
														<motion.div
															initial={{
																opacity: 0,
																y: 16,
																scale: 0.97,
															}}
															animate={{
																opacity: 1,
																y: 0,
																scale: 1,
															}}
															exit={{
																opacity: 0,
																y: 16,
																scale: 0.97,
															}}
															transition={{
																type: "spring",
																bounce: 0.3,
																duration: 0.5,
															}}
															className="flex w-full justify-center px-4"
														>
															<ChatErrorCard
																message={
																	visibleChatErrorMessage
																}
																isContextTooLarge={
																	isContextTooLarge
																}
																onReset={
																	resetChat
																}
																onRetry={reload}
																className="max-w-xl"
															/>
														</motion.div>
													)}
												</div>
											</div>
											<div
												aria-hidden
												className={twMerge(
													"pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-background_light via-background_light/75 to-transparent transition-opacity duration-300 ease-out dark:from-card dark:via-card/75",
													scrollEdges.top ? "opacity-100" : "opacity-0",
												)}
											/>
											<div
												aria-hidden
												className={twMerge(
													"pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-background_light via-background_light/75 to-transparent transition-opacity duration-300 ease-out dark:from-card dark:via-card/75",
													scrollEdges.bottom ? "opacity-100" : "opacity-0",
												)}
											/>
											{!isAtBottom && (
												<Button
													isIconOnly
													size="sm"
													className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
													aria-label="Scroll to bottom"
													onPress={() =>
														void scrollToBottom()
													}
												>
													<IoChevronDown className="size-4" />
												</Button>
											)}
										</motion.div>
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
														<div className="h-full w-full animate-gradient-x bg-gradient-to-r from-transparent via-accent/35 to-transparent bg-[length:200%_100%] motion-reduce:animate-none motion-reduce:bg-accent/20" />
													</motion.div>
												)}
										</AnimatePresence>
										<form
											className={twMerge(
												"relative flex min-w-0 w-full flex-col gap-4 p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] sm:gap-8 sm:p-8",
											)}
											onSubmit={handleSubmit}
										>
											<AnimatePresence mode="popLayout">
												{questions &&
													!isWaiting &&
													!conversationStarted && (
														<motion.ul
															key="questions"
															initial={{
																opacity: 0,
																y: 100,
															}}
															animate={{
																opacity: 1,
																y: 0,
															}}
															exit={{
																opacity: 0,
																y: -100,
															}}
															className="w-full flex flex-col lg:flex-row gap-4 max-w-[96rem] lg:px-14 mx-auto"
														>
															{(Array.isArray(
																questions,
															)
																? questions
																: []
															).map(
																(question) => (
																	<li
																		key={
																			question
																		}
																	>
																		<Button
																			className="text-wrap p-4 bg-transparent dark:bg-transparent min-h-fit h-full"
																			size="sm"
																			onClick={() => {
																				setInput(
																					question,
																				);
																			}}
																		>
																			{
																				question
																			}
																		</Button>
																	</li>
																),
															)}
														</motion.ul>
													)}
												<motion.div
													key="textarea"
													layout
													initial={false}
													animate={{
														y:
															isComposerFocused &&
															!prefersReducedMotion
																? -2
																: 0,
														scale:
															isComposerFocused &&
															!prefersReducedMotion
																? 1.004
																: 1,
													}}
													whileHover={
														prefersReducedMotion ||
														isWaiting
															? undefined
															: { y: -1 }
													}
													transition={{
														type: "spring",
														stiffness: 360,
														damping: 28,
													}}
													onFocusCapture={() =>
														setIsComposerFocused(
															true,
														)
													}
													onBlurCapture={(event) => {
														if (
															!event.currentTarget.contains(
																event.relatedTarget,
															)
														) {
															setIsComposerFocused(
																false,
															);
														}
													}}
													className="group/composer relative z-10 mx-auto w-full max-w-3xl min-w-0 overflow-hidden rounded-3xl border border-black/[0.08] bg-white p-2 shadow-[0_12px_40px_-34px_rgba(0,0,0,0.45)] transition-[border-color,box-shadow] duration-200 focus-within:border-accent/45 focus-within:shadow-[0_18px_48px_-32px_rgba(235,126,29,0.38)] dark:border-white/10 dark:bg-card dark:shadow-none dark:focus-within:shadow-[0_18px_48px_-32px_rgba(235,126,29,0.22)]"
												>
													<motion.div
														aria-hidden="true"
														initial={false}
														animate={{
															opacity:
																isComposerFocused ||
																isWaiting
																	? 1
																	: 0,
															scaleX:
																isComposerFocused ||
																isWaiting
																	? 1
																	: 0.35,
														}}
														transition={{
															duration:
																prefersReducedMotion
																	? 0
																	: 0.24,
															ease: [
																0.22, 1, 0.36,
																1,
															],
														}}
														className="pointer-events-none absolute inset-x-8 top-0 h-px origin-center bg-gradient-to-r from-transparent via-accent to-transparent"
													/>
													<Textarea
														minRows={1}
														// The composer resizes the message viewport
														// above it; re-pin through the hook so it
														// isn't mistaken for the user scrolling up.
														onHeightChange={() => {
															if (isAtBottom)
																void scrollToBottom({
																	animation: "instant",
																});
														}}
														onKeyDown={(e) => {
															if (
																e.key ===
																	"Enter" &&
																!e.shiftKey &&
																!e.nativeEvent
																	.isComposing
															) {
																e.preventDefault();
																handleSubmit(e);
															}
														}}
														autoFocus
														autoComplete="off"
														aria-label={t("askAI")}
														placeholder={t(
															data?.item?.title
																? "askMeAnything"
																: "askMeAnythingPublications",
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
													<div className="mt-1 flex min-w-0 items-center justify-between gap-2 border-t border-black/[0.06] px-1 pt-2 dark:border-white/[0.08]">
														<div className="flex min-w-0 items-center gap-1">
															{isDeepResearchEnabled && (
																<Tooltip
																	content={tUI(
																		"researchModeTooltip",
																	)}
																>
																	<Button
																		type="button"
																		size="sm"
																		variant="transparent"
																		aria-pressed={
																			mode ===
																			"research"
																		}
																		aria-label={tUI(
																			"researchMode",
																		)}
																		onPress={() =>
																			setMode(
																				mode ===
																					"research"
																					? "quick"
																					: "research",
																			)
																		}
																		className={twMerge(
																			"h-8 min-w-8 gap-1.5 rounded-2xl bg-black/[0.035] px-2 text-black/55 transition-colors hover:bg-black/[0.06] dark:bg-white/[0.05] dark:text-white/55 dark:hover:bg-white/[0.08]",
																			mode ===
																				"research" &&
																				"bg-accent/10 text-accent hover:bg-accent/15 dark:bg-accent/15 dark:text-accent",
																		)}
																	>
																		<motion.span
																			initial={
																				false
																			}
																			animate={{
																				scale:
																					mode ===
																					"research"
																						? 1.12
																						: 1,
																				rotate:
																					mode ===
																					"research"
																						? 0
																						: -8,
																			}}
																			transition={{
																				type: "spring",
																				stiffness: 420,
																				damping: 22,
																			}}
																			className="grid place-items-center"
																		>
																			<PiBinocularsBold className="size-4 shrink-0" />
																		</motion.span>
																		<span className="hidden whitespace-nowrap sm:inline">
																			{tUI(
																				"researchMode",
																			)}
																		</span>
																	</Button>
																</Tooltip>
															)}
															<ButtonGroup className="shrink-0 overflow-hidden rounded-2xl bg-black/[0.035] dark:bg-white/[0.05]">
																<Tooltip
																	content={`${tUI("smartScreening")} ${tUI("settings")}`}
																>
																	<Button
																		type="button"
																		size="sm"
																		variant="transparent"
																		className="h-8 min-w-8 gap-1.5 rounded-none border-0 px-2 text-black/55 transition-colors hover:bg-black/[0.05] dark:text-white/55 dark:hover:bg-white/[0.06]"
																		isDisabled={
																			isMutating
																		}
																		aria-label={`${tUI("smartScreening")} ${tUI("settings")}`}
																		onPress={
																			onSmartScreeningOpen
																		}
																	>
																		<PiGearSixBold className="size-4 shrink-0 transition-transform duration-300 group-hover:rotate-45 motion-reduce:transition-none" />
																		<span className="hidden whitespace-nowrap sm:inline">
																			{tUI(
																				"smartScreening",
																			)}
																		</span>
																	</Button>
																</Tooltip>
																<Tooltip
																	content={
																		smartScreeningFields.length ===
																		0
																			? tUI(
																					"noFieldsAdded",
																				)
																			: screenableContent.length ===
																				  0
																				? tUI(
																						"noResourcesForScreening",
																					)
																				: tUI(
																						"smartScreening",
																					)
																	}
																>
																	<Button
																		isIconOnly
																		type="button"
																		size="sm"
																		variant="transparent"
																		className="!h-8 !w-8 !min-w-8 shrink-0 rounded-none border-0 border-l border-black/[0.06] bg-accent/10 text-accent transition-colors hover:bg-accent/15 dark:border-white/[0.08] dark:bg-accent/15 dark:text-accent dark:hover:bg-accent/20"
																		isDisabled={
																			isLoading ||
																			isMutating ||
																			!canRunScreening
																		}
																		aria-label={tUI(
																			"smartScreening",
																		)}
																		onPress={() =>
																			void handleScreening(
																				screenableContent,
																			)
																		}
																	>
																		{isMutating ? (
																			<ImSpinner8 className="size-3.5 animate-spin" />
																		) : (
																			<PiPlayFill className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
																		)}
																	</Button>
																</Tooltip>
															</ButtonGroup>
														</div>
														<motion.div
															whileHover={
																prefersReducedMotion ||
																isWaiting
																	? undefined
																	: {
																			scale: 1.07,
																		}
															}
															whileTap={
																prefersReducedMotion ||
																isWaiting
																	? undefined
																	: {
																			scale: 0.9,
																		}
															}
															className="shrink-0"
														>
															<Button
																isDisabled={
																	isWaiting
																}
																type="submit"
																isIconOnly
																color="accent"
																size="sm"
																className="group/send !h-8 !w-8 !min-w-8 shrink-0 rounded-2xl border-0"
																aria-label={tUI(
																	"sendMessageAriaLabel",
																)}
															>
																<AnimatePresence
																	mode="wait"
																	initial={
																		false
																	}
																>
																	<motion.span
																		key={
																			isWaiting
																				? "waiting"
																				: isInputReady
																					? "ready"
																					: "idle"
																		}
																		initial={
																			prefersReducedMotion
																				? false
																				: {
																						opacity: 0,
																						scale: 0.72,
																						x: -2,
																						y: 2,
																					}
																		}
																		animate={{
																			opacity: 1,
																			scale: 1,
																			x: 0,
																			y: 0,
																		}}
																		exit={{
																			opacity: 0,
																			scale: 0.72,
																		}}
																		transition={{
																			type: "spring",
																			stiffness: 520,
																			damping: 30,
																		}}
																		className="grid place-items-center"
																	>
																		{isWaiting ? (
																			<ImSpinner8 className="size-4 animate-spin" />
																		) : (
																			<PiPaperPlaneTiltFill className="size-4 transition-transform duration-200 group-hover/send:translate-x-0.5 group-hover/send:-translate-y-0.5 motion-reduce:transition-none" />
																		)}
																	</motion.span>
																</AnimatePresence>
															</Button>
														</motion.div>
													</div>
												</motion.div>
											</AnimatePresence>
										</form>
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
