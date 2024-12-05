"use client";

import { Button } from "@/components/nextui/Button";
import {
    Modal, ModalHeader,
    ModalContent,
    Input,
    ModalBody,
    ModalFooter
} from "@nextui-org/react";
import { LuBot, LuUser, LuX } from "react-icons/lu";
import { twMerge } from "tailwind-merge";
import { ImSpinner8 } from "react-icons/im";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect } from "react";
import { useRef } from "react";
import { useState } from "react";
import { ItemGetResponse } from "@/app/api/item/types";
import { SectionTitle } from "@/components/typography/SectionTitle";
import { BsStars } from "react-icons/bs";

type Message = {
	role: "user" | "assistant";
	content: string;
};

export default function ChatModal({ isOpen, onOpenChange, data }: { isOpen: boolean, onOpenChange: (open: boolean) => void, data: ItemGetResponse | undefined }) {
    const [currentMessage, setCurrentMessage] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);

	const [chatHistory, setChatHistory] = useState<Message[]>([
		{
			role: "user",
			content: JSON.stringify(data),
		},
	]);
	const messageListRef = useRef<HTMLDivElement>(null);

    const sendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!currentMessage.trim()) return;
		setChatHistory((prev) => [
			...prev,
			{
				role: "user",
				content: currentMessage.trim(),
			},
			{
				role: "assistant",
				content: "",
			},
		]);
		setCurrentMessage("");

		try {
			setIsLoading(true);
			const response = await fetch("/api/ai/chat", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify([
					...chatHistory,
					{ role: "user", content: currentMessage.trim() },
				]),
			});

			if (!response.ok) {
				throw new Error("Error sending message");
			}

			const reader = response.body?.getReader();
			const decoder = new TextDecoder();

			if (!reader) return;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const text = decoder.decode(value, { stream: true });
				setChatHistory((messages) => {
					const lastMessage = messages[messages.length - 1];
					const otherMessages = messages.slice(0, messages.length - 1);
					return [
						...otherMessages,
						{ ...lastMessage, content: lastMessage.content + text },
					];
				});
			}
		} catch (error) {
			console.error("Error:", error);
			setChatHistory((messages) => [
				...messages,
				{
					role: "assistant",
					content:
						"I'm sorry, but I encountered an error. Please try again later.",
				},
			]);
		}
		setIsLoading(false);
	};

    useEffect(() => {
		const apply = () => {
			if (messageListRef.current) {
				messageListRef.current.scrollTop =
					messageListRef.current.scrollHeight;
				console.log("scrolled");
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
	}, [chatHistory]);

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
							<SectionTitle>
								<div className="flex items-center gap-2 text-accent">
									<BsStars />
									<span className="bg-gradient-to-r from-accent to-accent-800 bg-clip-text text-transparent">
										Ask AI
									</span>
								</div>
							</SectionTitle>
							<Button
								onClick={onClose}
								isIconOnly
								variant="transparent"
								className="xl:px-0 px-0 translate-x-2"
								startContent={
									<LuX className="size-6 text-black dark:text-white/80" />
								}
							/>
						</ModalHeader>
						<ModalBody className="p-0 min-h-[50vh] w-full">
							<div
								className="flex flex-col gap-4 w-full overflow-y-scroll overflow-x-hidden py-8"
								ref={messageListRef}
							>
								{chatHistory
									.filter((message, index) => index > 0)
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
													"bg-secondary dark:bg-secondary/50 rounded-xl p-4 text-wrap max-w-full overflow-hidden break-words text-lg",
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
							<form className="w-full" onSubmit={sendMessage}>
								<Input
									isDisabled={isLoading}
									autoComplete="off"
									label="Ask AI"
									value={currentMessage}
									onValueChange={setCurrentMessage}
									classNames={{
										inputWrapper: "rounded-t-none",
									}}
								/>
							</form>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	);
}
