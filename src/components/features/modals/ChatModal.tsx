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
import { DefaultChatTransport } from "ai";
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

function createTextMessage(role: 'system' | 'user' | 'assistant' | 'data', content: string, id: string): Message {
	return {
		id,
		role,
		parts: [{ type: 'text', text: content }],
	} as Message;
}
import FullScreenModal from "@/components/nextui/FullScreenModal";
import { getAIProviderPresentation } from "@/constants/ai";
import { FaTools } from "react-icons/fa";
import { AIMarkdown } from "../markdown/Markdown";
import { Input } from "@/components/nextui/Input";
import DialogModal from "@/components/nextui/DialogModal";
import { Textarea } from "@/components/nextui/Textarea";
import { AnimatePresence, motion } from "framer-motion";
import { RiRefreshLine, RiResetLeftFill } from "react-icons/ri";
import { useLocalStorage } from "usehooks-ts";
import { SmartScreeningField, useIsAISearchEnabled } from "@/components/pages/EvidenceLibrary";
import useSWRMutation from "swr/mutation";
import { cleanAIResponse, fetcher, setter } from "@/lib/utils";
import { getRateLimits, runScreening } from "@/lib/actions";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import Resource from "../items/Resource";
import { GiStarSwirl } from "react-icons/gi";
import { FaExclamationTriangle } from "react-icons/fa";
import { Switch } from "@/components/nextui/Switch";
import { BsQuestionCircleFill } from "react-icons/bs";
import { Card } from "@/components/nextui/Card";
import { Tooltip } from "@/components/nextui/Tooltip";
import type { AIProviderId } from "@/lib/ai-provider-factory";

export const maxDuration = 240;

interface ScreeningResults {
	result: {
		[resourceId: string]: {
			screeningFields: {
				[key: string]: string;
			};
		};
	};
	fields: SmartScreeningField[];
}

function ScreeningResults({ results }: { results: ScreeningResults }) {
	return (
		<div className="w-full space-y-6">
			{Object.entries(results.result).map(([resourceId, value]) => (
				<div
					key={resourceId}
					className="border border-white dark:border-secondary-600 rounded-2xl overflow-hidden"
				>
					<Resource itemKey={resourceId} abstract={true} />
					<div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-4">
						{Object.entries(value.screeningFields).map(
							([fieldKey, fieldValue]) => {
								const fieldInfo = results.fields.find(
									(field) => field.label === fieldKey
								);

								return (
									<div
										key={fieldKey}
										className="border-b pb-2 border-white dark:border-secondary-600"
									>
										<h3 className="font-medium text-sm text-black/60 dark:text-white/60">
											{`${fieldKey} (${fieldInfo?.type})`}
										</h3>
										<div className="mt-1">
											{String(fieldValue)}
										</div>
									</div>
								);
							}
						)}
					</div>
				</div>
			))}
		</div>
	);
}

function MessageComponent({
	message,
	provider,
	isMutating,
	isWaiting,
	handleScreening,
	smartScreeningFields,
	error,
}: {
	message: Message;
	provider: AIProviderId | null;
	isMutating: boolean;
	isWaiting: boolean;
	handleScreening: (content: string) => void;
	smartScreeningFields: SmartScreeningField[];
	error: boolean;
}) {
	const presentation = getAIProviderPresentation(provider);
	const tUI = useTranslations("ui");

	const annotations = useMemo<Array<{ id: string; message: string }>>(() => {
		// In v6, tool parts are named `tool-${toolName}` instead of "tool-invocation"
		// For now, we'll just return an empty array since the old annotations system
		// may not be supported. You can customize this based on your needs.
		return [];
	}, [message]);

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
				{annotations.length > 0 && (
					<div className="flex items-center gap-2">
						<div className="w-full flex flex-col rounded-t-xl p-0 text-wrap max-w-full overflow-hidden break-words text-lg opacity-80 divide-accent dark:divide-accent-300 relative">
							<AnimatePresence mode="popLayout">
								{annotations.length > 0 && (
									<motion.div
										key={
											annotations[annotations.length - 1]
												.id || annotations.length - 1
										}
										initial={{ opacity: 0, x: -20 }}
										animate={{ opacity: 1, x: 0 }}
										exit={{ opacity: 0, x: 20 }}
										transition={{ duration: 0.3 }}
										className={twMerge(
											"flex items-center gap-2 bg-clip-text text-transparent",
											isWaiting
												? "bg-gradient-to-r from-accent via-accent-700 to-accent animate-gradient-x"
												: "bg-gradient-to-r from-accent to-accent-700"
										)}
									>
										{React.createElement(
											presentation.icon,
											{
												className: "size-4 fill-accent shrink-0",
											}
										)}
										{
											annotations[annotations.length - 1]
												.message
										}
									</motion.div>
								)}
							</AnimatePresence>
						</div>
					</div>
				)}
				{getMessageContent(message).trim().length === 0 && !error ? (
					<div className={twMerge("p-4 opacity-60 ")}>
						<div className="w-fit bg-black flex items-center justify-center rounded-full p-2">
							<Spinner />
						</div>
					</div>
				) : message.role === "assistant" && getMessageContent(message).startsWith('{') ? (
					<ScreeningResults results={JSON.parse(getMessageContent(message))} />
				) : (
					<>
						<AIMarkdown
							className={twMerge(
								"p-4 prose dark:prose-invert space-y-4 w-full max-w-full",
								message.role !== "user" && "p-0 mt-6"
							)}
						>
							{cleanAIResponse(getMessageContent(message))}
						</AIMarkdown>
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

export type ChatMode = "full" | "quick";

export default function ChatModal({
	isOpen,
	onOpenChange,
	data,
	provider,
	questions,
	externalInput,
	setExternalInput,
	isEmbedded,
	setIsEmbedded,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	data?: ItemGetResponse | undefined;
	provider: AIProviderId | null;
	questions?: undefined | string[];
	externalInput?: string;
	setExternalInput?: (input: string) => void;
	isEmbedded?: boolean | null;
	setIsEmbedded?: React.Dispatch<React.SetStateAction<boolean | null>>;
	mode?: string;
}) {
	const [smartScreeningFields, setSmartScreeningFields] = useLocalStorage<
		SmartScreeningField[]
	>("smart-screening-fields", []);
	const { isDeepResearchEnabled } = useIsAISearchEnabled();
	const [internalMode, setMode] = useLocalStorage<ChatMode>("chat-mode", "full");
	const mode: ChatMode = isDeepResearchEnabled ? internalMode : "quick";

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
				key: data?.item?.key,
				provider,
				distinctId: getAnalyticsDistinctId(),
				smartScreeningFields,
				mode,
			},
		}),
		messages: [
			createTextMessage("assistant", t("chatPlaceholder", { title: data?.item?.title || "" }), "start"),
		],
		onFinish() {
			inputRef?.current?.focus();
		},
		onError: (e) => {
			const isRateLimited = e.message.includes("Rate limit exceeded");
			if (!isRateLimited) {
				// appendMessage(createTextMessage("assistant", t("errorMessage"), "error-" + Date.now()));
			} else {
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
			}
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
		if (!provider) return;
		const keys = content.match(/lib\/(\w+)/g);
		if (!keys) {
			return;
		}
		const keysArray = keys.map((key) => key.replace("lib/", ""));
		setIsMutating(true);
		try {
			const result = await runScreening(
				keysArray,
				provider,
				smartScreeningFields,
			);
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

	const hasPDFs = data?.item?.attachmentsData?.some(
		(attachment) => attachment.PDFCoverPageImage
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
						</AIHeader>
						<ModalBody className="p-0 w-full overflow-hidden">
							<div
								className={twMerge(
									"w-full h-full relative",
									reponseExists
										? "grid grid-rows-[1fr_auto]"
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
											<div className="max-w-[96rem] lg:px-24 mx-auto flex flex-col gap-8 ">
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
																	provider={
																		provider
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
								<AnimatePresence>
									{isEmbedded === false && hasPDFs && (
										<motion.div
											className="absolute top-0 left-0 w-full h-auto z-10"
											initial={{ opacity: 0, y: -100 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: -100 }}
											transition={{
												duration: 0.4,
												ease: "easeInOut",
											}}
										>
											<div className="max-w-3xl mx-auto mt-4 px-4">
												<div className="flex items-center gap-3 text-black/80 dark:text-white/80 bg-white/90 dark:bg-secondary/90 rounded-xl p-3 backdrop-blur-sm">
													<div className="flex-shrink-0 bg-accent-900/40 p-2 rounded-lg">
														<FaExclamationTriangle className="size-4 text-accent" />
													</div>
													<div className="flex-1">
														<p className="font-medium">
															{tUI(
																"preparingDocuments"
															)}
														</p>
														<p className="text-sm text-black/60 dark:text-white/60">
															{tUI(
																"documentProcessingInfo"
															)}
														</p>
													</div>
												</div>
											</div>
										</motion.div>
									)}
								</AnimatePresence>
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
														className="w-full flex flex-col lg:flex-row gap-4 max-w-[96rem] lg:px-14 mx-auto"
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
																mode === "full"
															}
															onValueChange={(
																value: boolean
															) => {
																setMode(
																	value
																		? "full"
																		: "quick"
																);
															}}
															color="accent"
															size="sm"
															classNames={{
																label: twMerge("text-sm transition-colors duration-300", mode === "full" && "!text-accent"),
																base: "gap-4"
															}}
														>
															{tUI("researchMode")}
														</Switch>
														<Tooltip content={tUI("researchModeTooltip")}>
															<BsQuestionCircleFill className={twMerge("text-black/60 dark:text-white/60 transition-colors duration-300", mode === "full" && "!text-accent")} />
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
