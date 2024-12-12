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
	useDisclosure,
} from "@nextui-org/react";
import AIModal from "../features/modals/AIModal";
import useAIStream from "@/hooks/useAIStream";
import ChatModal from "../features/modals/ChatModal";
import { useRouter } from "@/i18n/routing";
function AiButton({ data }: { data: ItemGetResponse | undefined }) {
	const { isOpen: isChatOpen, onOpenChange: onChatOpenChange } =
		useDisclosure();
	const { isOpen: isSummaryOpen, onOpenChange: onSummaryOpenChange } =
		useDisclosure();
	const { isOpen: isExplainOpen, onOpenChange: onExplainOpenChange } =
		useDisclosure();

	const { response: summaryResponse, stream: summaryStream } =
		useAIStream("/api/ai?prompt=summarize");
	const { response: explainResponse, stream: explainStream } =
		useAIStream("/api/ai?prompt=explain");

	return (
		<div className="fixed bottom-0 right-0">
			<div className="flex items-center justify-center p-4">
				<ChatModal
					isOpen={isChatOpen}
					onOpenChange={onChatOpenChange}
					data={data}
				/>
				<AIModal
					isOpen={isSummaryOpen}
					onOpenChange={onSummaryOpenChange}
					content={summaryResponse}
					title="Summary"
				/>
				<AIModal
					isOpen={isExplainOpen}
					onOpenChange={onExplainOpenChange}
					content={explainResponse}
					title="Explain"
				/>
				<Dropdown
					classNames={{
						content: "bg-white dark:bg-secondary",
					}}
				>
					<DropdownTrigger>
						<Button
							isIconOnly
							className="!p-0 rounded-full bg-gradient-to-r from-accent-400 to-accent-700 !text-white !outline-0 border-0 shadow-[0_0_12px_4px_rgba(255,255,255,0.1)] shadow-accent"
						>
							<BsStars />
						</Button>
					</DropdownTrigger>
					<DropdownMenu
						items={[
							{
								key: "summary",
								label: "Summarize",
								onClick: () => {
									onSummaryOpenChange();
									summaryStream(data);
								},
							},
							{
								key: "explain",
								label: "Explain",
								onClick: () => {
									onExplainOpenChange();
									explainStream(data);
								},
							},
							{
								key: "chat",
								label: "Ask AI",
								onClick: onChatOpenChange,
							},
						]}
						itemClasses={{
							base: "data-[hover]:bg-accent dark:data-[hover]:bg-accent data-[hover]:text-white dark:data-[hover]:text-white",
						}}
					>
						{(item) => (
							<DropdownItem key={item.key} onClick={item.onClick}>
								{item.label}
							</DropdownItem>
						)}
					</DropdownMenu>
				</Dropdown>
			</div>
		</div>
	);
}

export default function Item({ data }: { data: ItemGetResponse | undefined }) {
	const router = useRouter();

	return (
		<main className="w-full max-w-screen-2xl px-4 xl:px-14 flex flex-col gap-12 mt-4">
			<ItemControls router={router} />
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
										router={router}
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
