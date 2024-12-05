"use client";

import { ItemGetResponse } from "@/app/api/item/types";
import ItemRow from "@/components/features/items/ItemRow";
import ItemControls from "@/components/features/items/ItemControls";
import { BsStars } from "react-icons/bs";
import { Button } from "@/components/nextui/Button";
import {
	Dropdown,
	DropdownItem,
	DropdownTrigger,
	DropdownMenu,
	Modal,
	useDisclosure,
	ModalHeader,
	ModalContent,
	Input,
	ModalBody,
	ModalFooter,
} from "@nextui-org/react";
import { SectionTitle } from "../typography/SectionTitle";
import { LuBot, LuUser, LuX } from "react-icons/lu";
import { useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import { ImSpinner8 } from "react-icons/im";
import { Paragraph } from "../typography/Paragraph";
import { Skeleton } from "../nextui/Skeleton";

type Message = {
	role: "user" | "assistant";
	content: string;
};

function AiButton({ data }: { data: ItemGetResponse | undefined }) {
	const { isOpen: isChatOpen, onOpenChange: onChatOpenChange } =
		useDisclosure();
	const { isOpen: isSummaryOpen, onOpenChange: onSummaryOpenChange } =
		useDisclosure();
	const { isOpen: isExplainOpen, onOpenChange: onExplainOpenChange } =
		useDisclosure();

	const [chatHistory, setChatHistory] = useState<Message[]>([
		{
			role: "user",
			content: JSON.stringify({
				title: data?.item?.title || "",
				abstractNote: data?.item?.abstractNote || "",
			}),
		},
	]);
	const [currentMessage, setCurrentMessage] = useState<string>("");
	const inputRef = useRef<HTMLInputElement>(null);
	const messageListRef = useRef<HTMLDivElement>(null);
	const [summary, setSummary] = useState<string>("");
	const [explain, setExplain] = useState<string>("");

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
	};

	const getSummary = async () => {
		if (summary.length > 0) return;

		const response = await fetch("/api/ai/summary", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				title: data?.item?.title || "",
				abstractNote: data?.item?.abstractNote || "",
			}),
		});

		const reader = response.body?.getReader();
		const decoder = new TextDecoder();

		if (!reader) return;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			setSummary((prev) => prev + text);
		}
	};

	const getExplain = async () => {
		if (explain.length > 0) return;

		const response = await fetch("/api/ai/explain", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				title: data?.item?.title || "",
				abstractNote: data?.item?.abstractNote || "",
			}),
		});

		const reader = response.body?.getReader();
		const decoder = new TextDecoder();

		if (!reader) return;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			setExplain((prev) => prev + text);
		}
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
		<div className="fixed bottom-0 right-0">
			<div className="flex items-center justify-center p-4">
				<Modal
					size="4xl"
					scrollBehavior="inside"
					placement="top-center"
					hideCloseButton
					classNames={{
						base: "bg-background_light dark:bg-card xl:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none xl:rounded-large min-h-dvh xl:min-h-0",
					}}
					isOpen={isChatOpen}
					onOpenChange={onChatOpenChange}
				>
					<ModalContent>
						{(onClose) => (
							<>
								<ModalHeader className="flex items-center justify-between gap-2">
									<SectionTitle>Ask AI</SectionTitle>
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
										{chatHistory.map((message, index) => (
											<div
												key={index}
												className={twMerge(
													"flex items-start justify-start gap-2 px-8 w-full",
													message.role !== "user" &&
														"flex-row-reverse",
													index == 0 && "hidden",
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
														"bg-secondary dark:bg-secondary/50 rounded-xl p-4 text-wrap max-w-full overflow-hidden break-words",
														message.role !==
															"user" &&
															"bg-accent dark:bg-accent-300"
													)}
												>
													{message.content.length ===
													0 ? (
														<ImSpinner8 className="animate-spin" />
													) : (
														message.content
													)}
												</div>
											</div>
										))}
									</div>
								</ModalBody>
								<ModalFooter className="p-0">
									<form
										className="w-full"
										onSubmit={sendMessage}
									>
										<Input
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
				<Modal
					size="4xl"
					scrollBehavior="inside"
					placement="top-center"
					hideCloseButton
					classNames={{
						base: "bg-background_light dark:bg-card xl:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none xl:rounded-large min-h-dvh xl:min-h-0",
					}}
					isOpen={isSummaryOpen}
					onOpenChange={onSummaryOpenChange}
				>
					<ModalContent className="h-full">
						{(onClose) => (
							<>
								<ModalHeader className="flex items-center justify-between gap-2">
									<SectionTitle>Summary</SectionTitle>
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
								<ModalBody className="w-full">
									<Skeleton
										isLoaded={summary.length > 0}
										className="w-full h-full rounded-2xl"
									>
										<Paragraph>{summary}</Paragraph>
									</Skeleton>
								</ModalBody>
							</>
						)}
					</ModalContent>
				</Modal>
				<Modal
					size="4xl"
					scrollBehavior="inside"
					placement="top-center"
					hideCloseButton
					classNames={{
						base: "bg-background_light dark:bg-card xl:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none xl:rounded-large min-h-dvh xl:min-h-0",
					}}
					isOpen={isExplainOpen}
					onOpenChange={onExplainOpenChange}
				>
					<ModalContent className="h-full">
						{(onClose) => (
							<>
								<ModalHeader className="flex items-center justify-between gap-2">
									<SectionTitle>Explain</SectionTitle>
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
								<ModalBody className="w-full">
									<Skeleton
										isLoaded={explain.length > 0}
										className="w-full h-full rounded-2xl"
									>
										<Paragraph>{explain}</Paragraph>
									</Skeleton>
								</ModalBody>
							</>
						)}
					</ModalContent>
				</Modal>
				<Dropdown
					classNames={{
						content: "bg-white dark:bg-secondary",
					}}
				>
					<DropdownTrigger>
						<Button
							isIconOnly
							className="!p-0 rounded-full bg-gradient-to-r from-accent-400 to-accent-700 !text-white !outline-0 border-0 shadow-lg shadow-accent"
						>
							<BsStars />
						</Button>
					</DropdownTrigger>
					<DropdownMenu
						itemClasses={{
							base: "data-[hover]:bg-accent dark:data-[hover]:bg-accent data-[hover]:text-white dark:data-[hover]:text-white",
						}}
					>
						<DropdownItem
							onClick={() => {
								onSummaryOpenChange();
								getSummary();
							}}
							startContent={<BsStars />}
						>
							Summarize
						</DropdownItem>
						<DropdownItem
							onClick={() => {
								onExplainOpenChange();
								getExplain();
							}}
							startContent={<BsStars />}
						>
							Explain
						</DropdownItem>
						<DropdownItem
							startContent={<BsStars />}
							onClick={onChatOpenChange}
						>
							Ask AI
						</DropdownItem>
					</DropdownMenu>
				</Dropdown>
			</div>
		</div>
	);
}

export default function Item({ data }: { data: ItemGetResponse | undefined }) {
	return (
		<main className="w-full max-w-screen-2xl px-4 xl:px-14 flex flex-col gap-12 mt-4">
			<ItemControls />
			<div className="p-10 w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] flex flex-col gap-8 ">
				{data?.item ? (
					<>
						<h1 className="text-4xl text-black/80 dark:text-white/80 font-medium">
							{data?.item.title}
						</h1>
						<div className="flex flex-col gap-8">
							{data?.item &&
								Object.keys(data.item).map((row: string) => (
									<ItemRow
										item={data.item!}
										key={row}
										row={row}
									/>
								))}
						</div>
					</>
				) : (
					<div className="text-center text-2xl text-black/80 dark:text-white/80 font-medium min-h-screen flex items-center justify-center">
						Item not found
					</div>
				)}
			</div>
			{data && <AiButton data={data} />}
		</main>
	);
}
