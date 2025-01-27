"use client";

import { Button } from "@/components/nextui/Button";
import {
	ModalContent,
	Input,
	ModalBody,
	ModalFooter,
	ScrollShadow
} from "@nextui-org/react";
import { LuUser } from "react-icons/lu";
import { twMerge } from "tailwind-merge";
import { ImSpinner8 } from "react-icons/im";
import { useEffect } from "react";
import { useRef } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { IoSend } from "react-icons/io5";
import { useLocale, useTranslations } from "next-intl";
import { Message, useChat } from "ai/react";
import AIHeader from "../ai/AIHeader";
import AIModal from "@/components/nextui/AIModal";
import { models } from "@/constants/ai";
import { AIMarkdown } from "../markdown/Markdown";
import posthog from "posthog-js";

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
	const inputRef = useRef<HTMLInputElement>(null);

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
		body: { key: data?.item?.key, modelIndex, distinctId: posthog.get_distinct_id() },
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

	return (
		<AIModal
			size="4xl"
			scrollBehavior="inside"
			placement="top-center"
			hideCloseButton
			classNames={{
				base: "bg-background_light/80 dark:bg-card/80 backdrop-blur-xl xl:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none xl:rounded-large min-h-dvh xl:min-h-0 shadow-[0_0_10px_0_rgba(0,0,0,0.1)] shadow-accent outline-none",
			}}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<ModalContent>
				{(onClose) => (
					<>
						<AIHeader isLoading={isLoading} onClose={onClose}>
							{t("askAI")}
						</AIHeader>
						<ModalBody className="p-0 min-h-[50vh] w-full grid grid-cols-1 grid-rows-1">
							<ScrollShadow
								className="flex flex-col gap-4 w-full overflow-y-scroll overflow-x-hidden py-8  h-full"
								ref={messageListRef}
							>
								{messages.map((message, index) => (
									<div
										key={index}
										className={twMerge(
											"flex items-start justify-start gap-2 px-8 w-full",
											message.role !== "user" &&
												"flex-row-reverse"
										)}
									>
										<div className="rounded-full bg-accent dark:bg-accent p-2">
											{message.role === "user" ? (
												<LuUser className="size-4" />
											) : (
												models
													.filter(
														(model, index) =>
															index === modelIndex
													)
													.map((model) => (
														<model.icon
															key={model.name}
															className="size-4 invert"
														/>
													))
											)}
										</div>
										<div
											className={twMerge(
												"bg-white dark:bg-secondary rounded-xl p-4 text-wrap max-w-full overflow-hidden break-words text-lg",
												message.role !== "user" &&
													"bg-accent dark:bg-accent-300",
												message.id.includes("error") &&
													"bg-red-500 dark:bg-red-500"
											)}
										>
											{message.content.length === 0 ? (
												<ImSpinner8 className="animate-spin" />
											) : (
												<AIMarkdown>
													{message.content}
												</AIMarkdown>
											)}
										</div>
									</div>
								))}
							</ScrollShadow>
						</ModalBody>
						<ModalFooter className="p-0">
							<div className="w-full">
								<form
									className="w-full p-2"
									onSubmit={handleSubmit}
								>
									<Input
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
										fullWidth
									/>
								</form>
							</div>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</AIModal>
	);
}
