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
import React, { useEffect, useState } from "react";
import { useRef } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { IoSend } from "react-icons/io5";
import { useLocale, useTranslations } from "next-intl";
import { Message, useChat } from "ai/react";
import AIHeader from "../ai/AIHeader";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import { models } from "@/constants/ai";
import { FaTools } from "react-icons/fa";
import { AIMarkdown } from "../markdown/Markdown";
import posthog from "posthog-js";
import { Input } from "@/components/nextui/Input";
import DialogModal from "@/components/nextui/DialogModal";
import { Textarea } from "@/components/nextui/Textarea";
import { AnimatePresence, motion } from "framer-motion";
import { RiResetLeftFill } from "react-icons/ri";

export default function ChatModal({
	isOpen,
	onOpenChange,
	data,
	modelIndex,
	questions,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	data: ItemGetResponse | undefined;
	modelIndex: number;
	questions: undefined | string[];
}) {
	const t = useTranslations("ai");
	const locale = useLocale();
	const inputRef = useRef<any>(null);

	const {
		messages,
		handleSubmit,
		input,
		setInput,
		append,
		isLoading,
		stop,
		setMessages,
	} = useChat({
		api: "/api/ai/chat",
		initialMessages: [
			{
				role: "assistant",
				content: t("chatPlaceholder", { title: data?.item?.title }),
				id: "start",
			},
		],
		body: {
			key: data?.item?.key,
			modelIndex,
			distinctId: posthog.get_distinct_id(),
		},
		headers: {
			"Accept-Language": locale,
		},
		onFinish(message, options) {
			inputRef?.current?.focus();
		},
		onError: (e) => {
			const isRateLimited = e.message.includes("Rate limit exceeded");
			if (!isRateLimited) {
				appendMessage({
					role: "assistant",
					content: t("errorMessage"),
					id: "error-" + Date.now(),
				});
			} else {
				appendMessage({
					role: "assistant",
					content: t("rateLimitedMessage"),
					id: "error-" + Date.now(),
				});
			}
		},
	});

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

	const reponseExists = messages.some(
		(message, index) =>
			index > 0 &&
			message.role === "assistant" &&
			message.content.trim().length > 0
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
							isLoading={isLoading}
							onClose={onClose}
							className="sticky top-0 bg-white dark:bg-secondary-400 z-20"
						>
							{t("askAI")}
							<Button
								startContent={<RiResetLeftFill />}
								variant="light"
								size="sm"
								className="ml-4"
								aria-label="Reset"
								isDisabled={isLoading}
								onClick={() => {
									setMessages([...messages.slice(0, 1)]);
								}}
							>
								Reset Chat
							</Button>
						</AIHeader>
						<ModalBody className="p-0 w-full overflow-hidden">
							<div
								className={twMerge(
									"w-full h-full",
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
											<div className="max-w-[96rem] xl:px-24 mx-auto flex flex-col gap-8 ">
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
																<div
																	className={twMerge(
																		"rounded-full bg-accent dark:bg-accent p-2",
																		message.role !==
																			"user" &&
																			"hidden"
																	)}
																>
																	{message.role ===
																	"user" ? (
																		<LuUser className="size-4" />
																	) : (
																		React.createElement(
																			models[
																				modelIndex
																			]
																				.icon,
																			{
																				className:
																					"size-4 invert",
																			}
																		)
																	)}
																</div>
																<div
																	className={twMerge(
																		"p-0 text-wrap max-w-full overflow-hidden break-words text-lg",
																		message.role ===
																			"user" &&
																			"bg-white dark:bg-secondary rounded-xl",
																		message.role !==
																			"user" &&
																			"w-full px-8",
																		message.id.includes(
																			"error"
																		) &&
																			"text-red-500 dark:text-red-500 italic"
																	)}
																>
																	{message.parts.find(
																		(
																			part
																		) =>
																			part.type ===
																			"tool-invocation"
																	) && (
																		<div className="flex items-center gap-2">
																			<div className="w-full flex flex-col rounded-t-xl p-0 text-wrap max-w-full overflow-hidden break-words text-lg opacity-80 divide-accent dark:divide-accent-300">
																				{message.parts
																					.filter(
																						(
																							part
																						) =>
																							part.type ===
																							"tool-invocation"
																					)
																					.filter(
																						(
																							part,
																							idx,
																							arr
																						) =>
																							arr.findIndex(
																								(
																									p
																								) =>
																									p
																										.toolInvocation
																										.args
																										.userToolCallInformation ===
																									part
																										.toolInvocation
																										.args
																										.userToolCallInformation
																							) ===
																							idx
																					)
																					.map(
																						(
																							part,
																							index
																						) => (
																							<div
																								className="flex items-center gap-2 bg-clip-text text-transparent bg-gradient-to-r from-accent to-accent-700"
																								key={
																									part
																										.toolInvocation
																										.toolCallId
																								}
																							>
																								{React.createElement(
																									models[
																										modelIndex
																									]
																										.icon,
																									{
																										className:
																											"size-4 fill-accent",
																									}
																								)}
																								{
																									part
																										.toolInvocation
																										.args
																										.userToolCallInformation
																								}
																							</div>
																						)
																					)}
																			</div>
																		</div>
																	)}
																	{message.content.trim()
																		.length ===
																	0 ? (
																		<div
																			className={twMerge(
																				"p-4 opacity-60"
																			)}
																		>
																			<Spinner />
																		</div>
																	) : (
																		<AIMarkdown
																			className={twMerge(
																				"p-4",
																				message.role !==
																					"user" &&
																					"p-0"
																			)}
																		>
																			{
																				message.content
																			}
																		</AIMarkdown>
																	)}
																</div>
															</motion.div>
														)
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
									className="w-full flex justify-center xl:items-center items-end h-full"
								>
									<form
										className={twMerge(
											"w-full p-8 flex flex-col gap-4 relative"
										)}
										onSubmit={handleSubmit}
									>
										<AnimatePresence mode="popLayout">
											{(questions && !isLoading && !reponseExists) && (
												<motion.ul
													key="questions"
													initial={{ opacity: 0, y: 100 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -100 }}
													className="w-full flex flex-col xl:flex-row gap-4 max-w-[96rem] xl:px-14 mx-auto"
												>
													{(questions ?? []).map(
														(question, index) => (
															<li key={index}>
																<Button
																	className="text-wrap h-auto p-4 bg-transparent dark:bg-transparent"
																	size="sm"
																	onClick={() => {
																	setInput(
																		question
																	);
																	inputRef.current.focus();
																}}
															>
																{question}
															</Button>
														</li>
													))}
												</motion.ul>
											)}
											<motion.div
												key="textarea"
												layout
												transition={{
													type: "spring",
													bounce: 0.25,
													duration: 0.5
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
														isDisabled={isLoading}
														type="submit"
														isIconOnly
														className="flex items-center justify-center h-full aspect-square !p-0"
														aria-label={
															"Send message"
														}
													>
														{isLoading ? (
															<ImSpinner8 className="animate-spin" />
														) : (
															<IoSend className="size-4 text-black dark:text-white/60" />
														)}
													</Button>
												}
												placeholder={t("askMeAnything")}
												value={input}
												onValueChange={setInput}
												classNames={{
													base: twMerge(
														"xl:w-1/3 xl:mx-auto data-[focus=true]:xl:w-2/5 active:xl:scale-90 data-[focus]:active:xl:scale-100 transition-all duration-500 ease-spring data-[focus=true]:opacity-100"
													),
												}}
											/>
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
