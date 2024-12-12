"use client";

import { Button } from "@/components/nextui/Button";
import {
	Modal,
	ModalHeader,
	ModalContent,
	Input,
	ModalBody,
	ModalFooter,
} from "@nextui-org/react";
import { LuBot, LuUser, LuX } from "react-icons/lu";
import { twMerge } from "tailwind-merge";
import { ImSpinner8 } from "react-icons/im";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect } from "react";
import { useRef } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { SectionTitle } from "@/components/typography/SectionTitle";
import { BsStars } from "react-icons/bs";
import { IoSend } from "react-icons/io5";
import { useLocale, useTranslations } from "next-intl";
import { useChat } from "ai/react";

export default function ChatModal({
	isOpen,
	onOpenChange,
	data,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	data: ItemGetResponse | undefined;
}) {
	const t = useTranslations("ai");
	const locale = useLocale();
	const id = "1";

	const { messages, handleSubmit, input, setInput, append, isLoading, stop } = useChat({
		id,
		api: "/api/ai/chat",
		initialMessages: [
			{
				role: "assistant",
				content: t("chatPlaceholder", { title: data?.item?.title }),
				id: "start",
			},
		],
		body: { id, key: data?.item?.key },
		headers: {
			"Accept-Language": locale,
		},
	});

	const inputRef = useRef<HTMLInputElement>(null);
	const messageListRef = useRef<HTMLDivElement>(null);

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

	console.log(messages);

	return (
		<Modal
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
						<ModalHeader className="flex items-center justify-between gap-2">
							<SectionTitle
								startContent={
									<BsStars className="text-accent" />
								}
								className="flex items-center gap-2"
							>
								<span className="bg-gradient-to-r from-accent dark:to-accent-800 to-accent-600 bg-clip-text text-transparent">
									{t("askAI")}
								</span>
							</SectionTitle>
							<Button
								isDisabled={isLoading}
								onClick={onClose}
								isIconOnly
								variant="transparent"
								className="xl:px-0 px-0 translate-x-2 rtl:-translate-x-2"
								startContent={
									<LuX className="size-6 text-black dark:text-white/80" />
								}
							/>
						</ModalHeader>
						<ModalBody className="p-0 min-h-[50vh] w-full grid grid-cols-1 grid-rows-1">
							<div
								className="flex flex-col gap-4 w-full overflow-y-scroll overflow-x-hidden py-8  h-full"
								ref={messageListRef}
							>
								{messages
									.map((message, index) => (
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
													<LuUser />
												) : (
													<LuBot />
												)}
											</div>
											<div
												className={twMerge(
													"bg-secondary dark:bg-secondary rounded-xl p-4 text-wrap max-w-full overflow-hidden break-words text-lg",
													message.role !== "user" &&
														"bg-accent dark:bg-accent-300"
												)}
											>
												{message.content.length ===
												0 ? (
													<ImSpinner8 className="animate-spin" />
												) : (
													<Markdown
														remarkPlugins={[
															remarkGfm,
														]}
													>
														{message.content}
													</Markdown>
												)}
											</div>
										</div>
									))}
							</div>
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
		</Modal>
	);
}
