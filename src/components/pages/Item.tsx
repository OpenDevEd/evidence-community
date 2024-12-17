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
	ModalContent,
	ModalBody,
	Listbox,
	ListboxItem,
} from "@nextui-org/react";
import GenerativeModal from "../features/modals/GenerativeModal";
import useAIStream from "@/hooks/useAIStream";
import ChatModal from "../features/modals/ChatModal";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import Resource from "../features/items/Resource";
import { Skeleton } from "../nextui/Skeleton";
import AIHeader from "../features/ai/AIHeader";
import AIModal from "../nextui/AIModal";
import { useState } from "react";
import { FaCheck } from "react-icons/fa";
import { models } from "@/constants/ai";
import { useLocalStorage } from "usehooks-ts";
import { motion } from "framer-motion";
import { useFeatureFlagEnabled } from "@/context/Providers";

function AiButton({ data }: { data: ItemGetResponse | undefined }) {
	const t = useTranslations("ai");
	const [selectedModel, setSelectedModel] = useLocalStorage("ai-model", 0);

	const { isOpen: isChatOpen, onOpenChange: onChatOpenChange } =
		useDisclosure();
	const { isOpen: isSummaryOpen, onOpenChange: onSummaryOpenChange } =
		useDisclosure();
	const { isOpen: isExplainOpen, onOpenChange: onExplainOpenChange } =
		useDisclosure();
	const { isOpen: isChangeOpen, onOpenChange: onChangeOpenChange } =
		useDisclosure();

	const {
		response: summaryResponse,
		stream: summaryStream,
		error: summaryError,
	} = useAIStream("/api/ai?prompt=summarize");
	const {
		response: explainResponse,
		stream: explainStream,
		error: explainError,
	} = useAIStream("/api/ai?prompt=explain");

	return (
		<motion.div
			className="fixed bottom-0 right-0"
			initial={{ opacity: 0, x: 100 }}
			animate={{ opacity: 1, x: 0 }}
		>
			<div className="flex items-center justify-center p-4">
				<AIModal
					size="md"
					isOpen={isChangeOpen}
					onOpenChange={onChangeOpenChange}
				>
					<ModalContent>
						<AIHeader onClose={onChangeOpenChange}>
							{t("change")}
						</AIHeader>
						<ModalBody className="p-0">
							<div className="flex flex-col pt-0">
								<p className="text-base text-black/80 dark:text-white/80 font-medium p-2 text-center dark:bg-secondary bg-white">
									{t("changeAbtract")}
								</p>
								<Listbox
									onAction={(index) => {
										console.log(index);
										setSelectedModel(Number(index));
									}}
									classNames={{
										base: "p-0",
										list: "gap-0",
									}}
								>
									{models.map((model, index) => (
										<ListboxItem
											key={index}
											className="!p-0 !bg-transparent !rounded-none"
										>
											<div
												data-selected={
													index === selectedModel
												}
												className="p-6 cursor-pointer data-[selected=true]:dark:bg-accent/10 data-[selected=true]:bg-accent/20 transition-colors group rounded-none"
											>
												<div className="flex items-center gap-4 hover:brightness-75 active:scale-[95%] transition-all">
													<div className="size-10 shrink-0 bg-accent p-2 rounded">
														<model.icon className="h-full w-full invert" />
													</div>
													<div className="flex flex-col">
														<div className="flex items-center gap-2">
															<p className="font-medium">
																{model.name}
															</p>
															<span className="text-xs text-default-500">
																{t(
																	"byCompany",
																	{
																		company:
																			model.company,
																	}
																)}
															</span>
														</div>
														<p className="text-sm text-default-500">
															{model.model}
														</p>
													</div>
													<FaCheck className="size-4 shrink-0 text-accent ltr:ml-auto rtl:mr-auto group-data-[selected=true]:opacity-100 group-data-[selected=true]:translate-x-0 transition-all opacity-0 ltr:-translate-x-10 rtl:translate-x-10" />
												</div>
											</div>
										</ListboxItem>
									))}
								</Listbox>
							</div>
						</ModalBody>
					</ModalContent>
				</AIModal>
				<ChatModal
					isOpen={isChatOpen}
					onOpenChange={onChatOpenChange}
					data={data}
					modelIndex={selectedModel}
				/>
				<GenerativeModal
					isOpen={isSummaryOpen}
					onOpenChange={onSummaryOpenChange}
					content={summaryResponse}
					title={t("summarize")}
					error={summaryError}
				/>
				<GenerativeModal
					isOpen={isExplainOpen}
					onOpenChange={onExplainOpenChange}
					content={explainResponse}
					title={t("explain")}
					error={explainError}
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
								key: "change",
								label: t("change"),
								description: t("changeDescription", {
									model: models[selectedModel].name,
								}),
								startContent: (
									<>
										{models
											.filter(
												(model, index) =>
													index === selectedModel
											)
											.map((model) => (
												<div
													key={model.name}
													className="size-8 shrink-0 bg-accent p-1.5 rounded"
												>
													<model.icon className="h-full w-full invert" />
												</div>
											))}
									</>
								),
								onClick: () => {
									onChangeOpenChange();
								},
							},
							{
								key: "summary",
								label: t("summarize"),
								description: t("summarizeDescription"),
								onClick: () => {
									onSummaryOpenChange();
									summaryStream(data?.item?.key ?? "", {
										body: {
											modelIndex: selectedModel,
										},
									});
								},
							},
							{
								key: "explain",
								label: t("explain"),
								description: t("explainDescription"),
								onClick: () => {
									onExplainOpenChange();
									explainStream(data?.item?.key ?? "", {
										body: {
											modelIndex: selectedModel,
										},
									});
								},
							},
							{
								key: "chat",
								label: t("askAI"),
								description: t("chatDescription"),
								onClick: onChatOpenChange,
							},
						]}
						itemClasses={{
							base: "data-[hover]:bg-accent dark:data-[hover]:bg-accent data-[hover]:text-white dark:data-[hover]:text-white",
						}}
					>
						{(item) => (
							<DropdownItem
								key={item.key}
								description={item.description}
								onClick={item.onClick}
								startContent={item.startContent}
								className="gap-4"
							>
								{item.label}
							</DropdownItem>
						)}
					</DropdownMenu>
				</Dropdown>
			</div>
		</motion.div>
	);
}

export default function Item({ data }: { data: ItemGetResponse | undefined }) {
	const router = useRouter();
	const t = useTranslations("ui");
	const isAIEnabled = useFeatureFlagEnabled("ai-features");
	const isRelatedItemsEnabled = useFeatureFlagEnabled("related-resources");
	const { data: embeddings } = useSWR(
		isRelatedItemsEnabled ? `/ai/embeddings/${data?.item?.key}` : null,
		fetcher
	);

	return (
		<main className="w-full max-w-screen-2xl px-4 xl:px-14 flex flex-col gap-4">
			<div className="w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] ">
				<ItemControls itemData={data?.item} router={router} />
				<div className="flex flex-col gap-8 p-10">
					{data?.item ? (
						<>
							<h1 className="text-4xl text-black/80 dark:text-white/80 font-medium">
								{data?.item.title}
							</h1>
							<div className="flex flex-col gap-8">
								{data?.item &&
									Object.keys(data.item).map(
										(row: string) => (
											<ItemRow
												item={data.item!}
												key={row}
												row={row}
												router={router}
											/>
										)
									)}
							</div>
						</>
					) : (
						<div className="text-center text-2xl text-black/80 dark:text-white/80 font-medium min-h-screen flex items-center justify-center">
							{t("itemNotFound")}
						</div>
					)}
				</div>
			</div>
			{isAIEnabled && data && <AiButton data={data} />}
			{isRelatedItemsEnabled && (
				<div className="w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] ">
					<div className="flex flex-row">
						<div className="text-xl font-medium text-black/60 dark:text-white/60 xl:w-64 w-24 shrink-0 rounded p-10">
							{t("relatedItems")}
						</div>
						<div className="w-full">
							<Skeleton
								isLoaded={!!embeddings}
								className="data-[loaded]:min-h-0 min-h-screen rounded-2xl rounded-l-none p-4 w-full"
							>
								<ul className="grid grid-cols-1 gap-4">
									{embeddings?.hits.map((hit: any) => (
										<Resource
											key={hit.id}
											itemData={hit}
											abstract={false}
											isLoading={false}
										/>
									))}
								</ul>
							</Skeleton>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
