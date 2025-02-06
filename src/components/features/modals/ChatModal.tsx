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

export default function ChatModal({
	isOpen,
	onOpenChange,
	data,
	modelIndex,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	data: ItemGetResponse | undefined;
	modelIndex: number;
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
							className="sticky top-0"
						>
							{t("askAI")}
						</AIHeader>
						<ModalBody className="p-0 w-full">
							<div className="w-full h-full grid grid-rows-[1fr_auto]">
								{reponseExists && (
									<ScrollShadow
										className="flex flex-col gap-8 w-full overflow-y-scroll overflow-x-hidden py-8 h-full"
										ref={messageListRef}
									>
										{messages.map(
											(message, index) =>
												index > 0 && (
													<div
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
																	].icon,
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
																(part) =>
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
													</div>
												)
										)}
									</ScrollShadow>
								)}
								<div className="w-full flex justify-center items-center">
									<form
										className={twMerge("w-full p-4")}
										onSubmit={handleSubmit}
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
													aria-label={"Send message"}
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
													"",
													!reponseExists &&
														"xl:w-1/2 xl:mx-auto"
												),
											}}
										/>
									</form>
								</div>
							</div>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</DialogModal>
	);
}
