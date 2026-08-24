"use client";

import { Button } from "@/components/nextui/Button";
import {
	ModalContent,
	ModalBody,
	ModalFooter,
	ScrollShadow,
	Spinner,
} from "@nextui-org/react";
import { LuUser } from "react-icons/lu";
import { twMerge } from "tailwind-merge";
import { ImSpinner8 } from "react-icons/im";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { IoSend } from "react-icons/io5";
import { useLocale, useTranslations } from "next-intl";
import { UIMessage, useChat } from "@ai-sdk/react";
import {
	DefaultChatTransport,
	isReasoningUIPart,
	isTextUIPart,
	isToolUIPart,
} from "ai";
import AIHeader from "../ai/AIHeader";

// Type alias for backward compatibility
type Message = UIMessage;

// Helper functions to work with the new parts-based message format
function getMessageContent(message: Message): string {
	if (!message.parts) return '';
	return message.parts
		.map(part => {
			if (part.type === 'text') return part.text;
			return '';
		})
		.join('');
}

type VisibleMessagePart = {
	key: string;
	part: Message["parts"][number];
};

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

function createTextMessage(role: 'system' | 'user' | 'assistant' | 'data', content: string, id: string): Message {
	return {
		id,
		role,
		parts: [{ type: 'text', text: content }],
	} as Message;
}
import FullScreenModal from "@/components/nextui/FullScreenModal";
import { getAIModelPresentation } from "@/constants/ai";
import { FaTools } from "react-icons/fa";
import { AIMarkdown } from "../markdown/Markdown";
import { Input } from "@/components/nextui/Input";
import DialogModal from "@/components/nextui/DialogModal";
import { Textarea } from "@/components/nextui/Textarea";
import { AnimatePresence, motion } from "framer-motion";
import { RiRefreshLine, RiResetLeftFill } from "react-icons/ri";
import { useLocalStorage } from "usehooks-ts";
import { useIsAISearchEnabled } from "@/components/pages/EvidenceLibrary";
import type { SmartScreeningField } from "@/types/ai";
import useSWRMutation from "swr/mutation";
import { cleanAIResponse, fetcher, setter } from "@/lib/utils";
import { getRateLimits } from "@/lib/actions";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import Resource from "../items/Resource";
import { GiStarSwirl } from "react-icons/gi";
import { Switch } from "@/components/nextui/Switch";
import { BsQuestionCircleFill } from "react-icons/bs";
import { Card } from "@/components/nextui/Card";
import { Tooltip } from "@/components/nextui/Tooltip";
import { clientAIError } from "@/lib/ai/client";
import type { LibrarySearchContext } from "@/lib/search-context";
import { ToolActivity } from "@/components/features/ai/ToolActivity";
import { LuCheck, LuHash, LuType, LuX } from "react-icons/lu";
import {
	AIGeneratedContentControls,
	AIStructuredContentControls,
	type ControlAction,
	type GeneratedContent,
} from "./AIControls";
import {
	isScreeningResultsData,
	screeningExportContent,
	type ScreeningFieldValue,
	type ScreeningResultsData,
} from "@/lib/ai/screening-export";
import {
	CHAT_EXPORT_OUTPUT,
	chatMessageContent,
	chatTranscriptContent,
	type ChatTranscriptFormat,
} from "@/lib/ai/transcript-export";

export const maxDuration = 240;

/** Only a screening reply carries results, and only if they are well formed. */
function parseScreeningResults(messageId: string, content: string) {
	if (!messageId.startsWith("screening-")) return null;
	try {
		const parsed: unknown = JSON.parse(content);
		return isScreeningResultsData(parsed) ? parsed : null;
	} catch {
		return null;
	}
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
						className="overflow-hidden rounded-2xl bg-white/80 dark:bg-white/[0.035]"
					>
						<Resource itemKey={resourceId} abstract={true} as="div" />
						<div className="grid grid-cols-1 gap-3 bg-black/[0.025] p-3 dark:bg-black/[0.15] sm:p-4 md:grid-cols-2">
							{results.fields.map((field, fieldIndex) => (
								<ScreeningField
									key={field.label}
									field={field}
									value={value.screeningFields[field.label] ?? null}
									isLast={fieldIndex === results.fields.length - 1}
									fieldCount={results.fields.length}
								/>
							))}
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

function ScreeningFieldIcon({
	type,
	value,
}: {
	type: ScreeningResultsData["fields"][number]["type"];
	value: ScreeningFieldValue;
}) {
	if (type === "number") return <LuHash />;
	if (type === "string") return <LuType />;
	return value === true ? <LuCheck /> : <LuX />;
}

function ScreeningField({
	field,
	value,
	fieldCount,
	isLast,
}: {
	field: ScreeningResultsData["fields"][number];
	value: ScreeningFieldValue;
	fieldCount: number;
	isLast: boolean;
}) {
	const isBoolean = field.type === "boolean";
	const isTrue = isBoolean && value === true;

	return (
		<section
			className={twMerge(
				"min-w-0 rounded-xl bg-white/80 p-4 dark:bg-white/[0.045]",
				fieldCount % 2 === 1 && isLast && "md:col-span-2",
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<h3 className="min-w-0 text-xs font-medium leading-5 text-black/50 dark:text-white/50">
					{field.label}
				</h3>
				<span
					className={twMerge(
						"grid size-7 shrink-0 place-items-center rounded-lg bg-black/[0.045] text-sm text-black/40 dark:bg-white/[0.06] dark:text-white/40",
						isTrue &&
							"bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent",
					)}
					role="img"
					aria-label={field.type}
				>
					<ScreeningFieldIcon type={field.type} value={value} />
				</span>
			</div>
			<p
				className={twMerge(
					"mt-2 break-words text-base font-medium leading-6 text-black/80 dark:text-white/80",
					isTrue && "text-accent dark:text-accent",
				)}
			>
				{String(value)}
			</p>
		</section>
	);
}

function MessageComponent({
	message,
	modelId,
	isMutating,
	isWaiting,
	handleScreening,
	smartScreeningFields,
	error,
}: {
	message: Message;
	modelId: string | null;
	isMutating: boolean;
	isWaiting: boolean;
	handleScreening: (content: string) => void;
	smartScreeningFields: SmartScreeningField[];
	error: boolean;
}) {
	const presentation = getAIModelPresentation(modelId);
	const tUI = useTranslations("ui");

	const visibleParts = useMemo(
		() => visibleMessageParts(message),
		[message],
	);
	const screeningResults = useMemo(
		() => parseScreeningResults(message.id, getMessageContent(message)),
		[message],
	);
	const showMessageActions =
		message.role === "assistant" &&
		!isWaiting &&
		!error &&
		!screeningResults &&
		!message.id.includes("error") &&
		getMessageContent(message).trim().length > 0;
	const exportMessage = useCallback(
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
					message.role !== "user" && "hidden"
				)}
			>
				{message.role === "user" ? (
					<LuUser className="size-4 text-white" />
				) : (
					React.createElement(presentation.icon, {
						className: "size-4 invert shrink-0",
					})
				)}
			</div>
			<div
				className={twMerge(
					"p-0 text-wrap max-w-full overflow-hidden break-words text-lg",
					message.role === "user" &&
						"bg-white dark:bg-secondary rounded-xl",
					message.role !== "user" && "w-full px-8",
					message.id.includes("error") &&
						"text-red-500 dark:text-red-500 italic"
				)}
			>
				{getMessageContent(message).trim().length === 0 && !error ? (
					<div className={twMerge("p-4 opacity-60 ")}>
						<div className="w-fit bg-black flex items-center justify-center rounded-full p-2">
							<Spinner />
						</div>
					</div>
				) : screeningResults ? (
					<ScreeningResults results={screeningResults} />
				) : (
					<>
						{message.role === "assistant" ? (
							visibleParts.map(({ key, part }) => {
								if (isReasoningUIPart(part)) {
									return (
										<AIMarkdown
											key={key}
											className="mt-4 prose prose-sm max-w-full text-black/50 dark:prose-invert dark:text-white/50"
										>
											{part.text}
										</AIMarkdown>
									);
								}

								if (isToolUIPart(part)) {
									return (
										<div key={key} className="mt-2">
											<ToolActivity part={part} />
										</div>
									);
								}

								if (isTextUIPart(part)) {
									return (
										<AIMarkdown
											key={key}
											className="p-0 mt-6 prose dark:prose-invert space-y-4 w-full max-w-full"
										>
											{cleanAIResponse(part.text)}
										</AIMarkdown>
									);
								}

								return null;
							})
						) : (
							<AIMarkdown
								className="p-4 prose dark:prose-invert space-y-4 w-full max-w-full"
							>
								{cleanAIResponse(getMessageContent(message))}
							</AIMarkdown>
						)}
						{showMessageActions && (
							<div className="mt-3 flex items-center gap-0.5">
								<AIGeneratedContentControls
									getContent={exportMessage}
									downloadName="ai-response"
									appearance="inline"
								/>
							</div>
						)}
						{message.role === "assistant" &&
							getMessageContent(message).includes("/lib/") &&
							smartScreeningFields.length > 0 && (
								<div className="flex items-center gap-2 mt-8">
									<Button
										isDisabled={isWaiting}
										startContent={
											isMutating ? (
												<ImSpinner8 className="animate-spin" />
											) : (
												<GiStarSwirl />
											)
										}
										size="sm"
										color="accent"
										onClick={() =>
											handleScreening(getMessageContent(message))
										}
									>
										{tUI("smartScreening")}
									</Button>
								</div>
							)}
					</>
				)}
			</div>
		</>
	);
}

/** The contract screens at most twenty-five publications in one request. */
const SCREENING_BATCH_LIMIT = 25;

export type ChatMode = "research" | "quick";

export default function ChatModal({
	isOpen,
	onOpenChange,
	data,
	modelId,
	searchContext,
	questions,
	externalInput,
	setExternalInput,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	data?: ItemGetResponse | undefined;
	modelId: string | null;
	searchContext?: LibrarySearchContext;
	questions?: undefined | string[];
	externalInput?: string;
	setExternalInput?: (input: string) => void;
	mode?: string;
}) {
	const [smartScreeningFields, setSmartScreeningFields] = useLocalStorage<
		SmartScreeningField[]
	>("smart-screening-fields", []);
	const { isDeepResearchEnabled } = useIsAISearchEnabled();
	const [internalMode, setMode] = useLocalStorage<ChatMode>(
		"chat-mode",
		"research",
	);
	const mode: ChatMode =
		isDeepResearchEnabled && internalMode === "research"
			? "research"
			: "quick";

	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const locale = useLocale();
	const inputRef = useRef<any>(null);
	const [input, setInput] = useState('');
	const {
		messages,
		sendMessage,
		error,
		status,
		regenerate,
		stop,
		setMessages,
	} = useChat({
		transport: new DefaultChatTransport({
			api: "/api/ai/chat",
			headers: {
				"Accept-Language": locale,
			},
			body: {
				itemKey: data?.item?.key,
				modelId,
				distinctId: getAnalyticsDistinctId(),
				mode,
				searchContext,
			},
		}),
		messages: [
			createTextMessage("assistant", t("chatPlaceholder", { title: data?.item?.title || "" }), "start"),
		],
		onFinish() {
			inputRef?.current?.focus();
		},
		onError: (error) => {
			const message = clientAIError(error).message;
			if (!message.includes("Rate limit exceeded")) {
				appendMessage(
					createTextMessage(
						"assistant",
						message,
						"error-" + Date.now(),
					),
				);
				return;
			}
			(async () => {
				const rateLimits = await getRateLimits();
				appendMessage(createTextMessage(
					"assistant",
					t("rateLimitedMessage", {
						seconds: rateLimits.retryAfter || 0,
					}),
					"error-" + Date.now()
				));
			})();
		},
	});

	const isLoading = status === 'submitted' || status === 'streaming';
	const reload = () => regenerate();
	const append = (message: { role: 'user' | 'assistant'; content: string }) => {
		sendMessage({ text: message.content });
	};
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (input.trim()) {
			sendMessage({ text: input });
			setInput('');
		}
	};

	const [isMutating, setIsMutating] = useState(false);

	const messageListRef = useRef<HTMLDivElement>(null);

	const appendMessage = (message: Message) => {
		setMessages((prevMessages) => [...prevMessages, message]);
	};

	useEffect(() => {
		const apply = () => {
			if (messageListRef.current) {
				messageListRef.current.scrollTop =
					messageListRef.current.scrollHeight;
			}
		};
		const observer = new MutationObserver(apply);
		if (messageListRef.current) {
			observer.observe(messageListRef.current as Node, {
				childList: true,
				subtree: true,
			});
		}
		apply();
		return () => observer.disconnect();
	}, [messages]);

	useEffect(() => {
		if (externalInput && isOpen) {
			append({
				role: "user",
				content: externalInput,
			});
			setExternalInput?.("");
		}
	}, [externalInput, isOpen]);

	const reponseExists = messages.some(
		(message, index) => index > 0 && message.role === "assistant"
	);

	const handleScreening = async (content: string) => {
		const keys = Array.from(
			content.matchAll(/\/lib\/([A-Za-z0-9:_-]+)/g),
			(match) => match[1],
		);
		if (!modelId || !keys.length || smartScreeningFields.length === 0) {
			return;
		}
		// One request screens at most twenty-five publications.
		const keysArray = [...new Set(keys)].slice(0, SCREENING_BATCH_LIMIT);
		setIsMutating(true);
		try {
			const response = await fetch("/api/ai/screen", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					keys: keysArray,
					modelId,
					fields: smartScreeningFields,
					distinctId: getAnalyticsDistinctId(),
				}),
			});
			if (!response.ok) throw new Error(await response.text());
			const result = await response.json();
		if (Object.keys(result).length > 0) {
			appendMessage(createTextMessage(
				"assistant",
				JSON.stringify({
					result: result,
					fields: smartScreeningFields,
				}),
				"screening-" + Date.now()
			));
		} else {
			appendMessage(createTextMessage(
				"assistant",
				tUI("noResourcesForScreening"),
				"screening-" + Date.now()
			));
		}
		} catch (error) {
			console.error(error);
		} finally {
			setIsMutating(false);
		}
	};

	const isWaiting = (isLoading || isMutating) && !error;
	const exportTranscript = useCallback(
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
					assistant: getAIModelPresentation(modelId).name,
					reasoning: t("reasoning"),
					smartScreening: tUI("smartScreening"),
				},
				window.location.origin,
			);
			return { content, ...CHAT_EXPORT_OUTPUT[format] };
		},
		[messages, modelId, t, tUI],
	);

	return (
		<DialogModal
			size="full"
			scrollBehavior="inside"
			hideCloseButton
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			classNames={{
				base: "border-none dark:border-none",
			}}
		>
			<ModalContent>
				{(onClose) => (
					<>
						<AIHeader
							isLoading={isWaiting}
							onClose={onClose}
							className="sticky top-0 bg-white dark:bg-secondary-400 z-20"
						>
							{t("askAI")}
							<Button
								startContent={<RiResetLeftFill />}
								variant="light"
								size="sm"
								className="ml-4"
								aria-label={tUI("resetAriaLabel")}
								isDisabled={isWaiting}
								onClick={() => {
									setMessages([...messages.slice(0, 1)]);
								}}
							>
								{tUI("resetChat")}
							</Button>
							<AIGeneratedContentControls
								getContent={exportTranscript}
								downloadName="chat-transcript"
								isDisabled={!reponseExists || isWaiting}
								appearance="header"
							/>
						</AIHeader>
						<ModalBody className="p-0 w-full overflow-hidden">
							<div
								className={twMerge(
									"w-full h-full relative",
									reponseExists
							? "grid grid-rows-chat"
										: "flex justify-center items-center"
								)}
							>
								{reponseExists && (
									<motion.div
										layoutId="chat-messages"
										layout="position"
										transition={{
											type: "spring",
											bounce: 0.25,
											duration: 0.5,
										}}
										className="w-full h-full overflow-y-scroll"
									>
										<ScrollShadow
											className="w-full overflow-y-scroll overflow-x-hidden py-8 h-full"
											ref={messageListRef}
										>
												<div className="max-w-screen-2xl lg:px-24 mx-auto flex flex-col gap-8 ">
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
																key={index}
																className={twMerge(
																	"flex items-start justify-start gap-2 w-full",
																	message.role ===
																		"user" &&
																		"flex-row-reverse px-8"
																)}
															>
																<MessageComponent
																	message={
																		message
																	}
																	modelId={
																		modelId
																	}
																	isMutating={
																		isMutating
																	}
																	isWaiting={
																		isWaiting
																	}
																	handleScreening={
																		handleScreening
																	}
																	smartScreeningFields={
																		smartScreeningFields
																	}
																	error={!!error}
																/>
															</motion.div>
														)
												)}
												{error && (
													<motion.div
														initial={{ opacity: 0, y: -100 }}
														animate={{ opacity: 1, y: 0 }}
														exit={{ opacity: 0, y: -100 }}
														className="flex justify-center items-center gap-2 w-full"
													>
														{t("errorMessage")}
														<Button
															color="accent"
															isIconOnly
															onClick={() => {
																reload()
															}}
														>
															<RiRefreshLine
																className="size-4"
															/>
														</Button>
													</motion.div>
												)}
											</div>
										</ScrollShadow>
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
									className="w-full flex justify-center lg:items-center items-end h-full"
								>
									<form
										className={twMerge(
											"w-full p-8 flex flex-col gap-8 relative"
										)}
										onSubmit={handleSubmit}
									>
										<AnimatePresence mode="popLayout">
											{questions &&
												!isWaiting &&
												!reponseExists && (
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
														className="w-full flex flex-col lg:flex-row gap-4 max-w-screen-2xl lg:px-14 mx-auto"
													>
														{(Array.isArray(
															questions
														)
															? questions
															: []
														).map(
															(
																question,
																index
															) => (
																<li key={index}>
																	<Button
																		className="text-wrap p-4 bg-transparent dark:bg-transparent min-h-fit h-full"
																		size="sm"
																		onClick={() => {
																			setInput(
																				question
																			);
																			inputRef.current.focus();
																		}}
																	>
																		{
																			question
																		}
																	</Button>
																</li>
															)
														)}
													</motion.ul>
												)}
											<motion.div
												key="textarea"
												layout
												transition={{
													type: "spring",
													bounce: 0.25,
													duration: 0.5,
												}}
												className="w-full z-10"
											>
												<Textarea
													minRows={1}
													onKeyDown={(e) => {
														if (
															e.key === "Enter" &&
															!e.shiftKey
														) {
															e.preventDefault();
															handleSubmit(e);
														}
													}}
													ref={inputRef}
													autoFocus
													autoComplete="off"
													label={t("askAI")}
													endContent={
														<Button
															isDisabled={
																isWaiting
															}
															type="submit"
															isIconOnly
															className="flex items-center justify-center h-full aspect-square !p-0"
															aria-label={tUI(
																"sendMessageAriaLabel"
															)}
														>
															{isWaiting ? (
																<ImSpinner8 className="animate-spin" />
															) : (
																<IoSend className="size-4 text-black dark:text-white/60" />
															)}
														</Button>
													}
													placeholder={t(
														data?.item?.title ? "askMeAnything" : "askMeAnythingPublications"
													)}
													value={input}
													onValueChange={setInput}
													classNames={{
														base: twMerge(
															"lg:w-1/3 lg:mx-auto data-[focus=true]:lg:w-2/5 active:lg:scale-90 data-[focus]:active:lg:scale-100 transition-all duration-500 ease-spring data-[focus=true]:opacity-100"
														),
													}}
												/>
												{isDeepResearchEnabled && <div className={twMerge("flex items-center gap-2 justify-center mt-8 transition-all duration-500 ease-spring", reponseExists && "mt-4")}>
													<Card color="card" className={twMerge("flex flex-row p-4 py-3 rounded-2xl items-center gap-4 !transition-all duration-600", mode === "quick" && "opacity-50 hover:opacity-100")}>
														<Switch
															isSelected={
																mode === "research"
															}
															onValueChange={(
																value: boolean
															) => {
																setMode(
																	value
																		? "research"
																		: "quick"
																);
															}}
															color="accent"
															size="sm"
															classNames={{
																label: twMerge("text-sm transition-colors duration-300", mode === "research" && "!text-accent"),
																base: "gap-4"
															}}
														>
															{tUI("researchMode")}
														</Switch>
														<Tooltip content={tUI("researchModeTooltip")}>
															<BsQuestionCircleFill className={twMerge("text-black/60 dark:text-white/60 transition-colors duration-300", mode === "research" && "!text-accent")} />
														</Tooltip>
													</Card>
												</div>}
											</motion.div>
										</AnimatePresence>
									</form>
								</motion.div>
							</div>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</DialogModal>
	);
}
