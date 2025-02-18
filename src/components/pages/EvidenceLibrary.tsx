"use client";
import { Button } from "@/components/nextui/Button";
import CollectionsList from "@/components/features/collections/CollectionsList";
import { IoGrid, IoSearch } from "react-icons/io5";
import { Select } from "@/components/nextui/Select";
import { Input } from "@/components/nextui/Input";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import { ModalContent, Spinner, useDisclosure } from "@nextui-org/react";
import React, { ReactNode, use, useRef, useState } from "react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { AiOutlineCompass } from "react-icons/ai";
import { useDebounce } from "@/hooks/useDebounce";
import { SORT_OPTIONS, SCOPE_OPTIONS } from "@/constants/items";
import HelpModal from "@/components/features/modals/HelpModal";
import { useFormatter, useTranslations } from "next-intl";
import { GiArchiveResearch } from "react-icons/gi";
import { FaSort } from "react-icons/fa";
import { HiOutlineViewList } from "react-icons/hi";
import { BiHelpCircle } from "react-icons/bi";
import { twMerge } from "tailwind-merge";
import PageContainer from "../layout/PageContainer";
import FullScreenModal from "../nextui/FullScreenModal";
import GenericHeader from "../features/modals/GenericHeader";
import { useItemsList } from "@/hooks/useItemsList";
import ItemsList, { ItemsContext } from "../features/items/ItemsList";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import ChatModal from "../features/modals/ChatModal";
import ModelSelector from "../features/ai/ModelSelector";

function DropDownIcon({
	Icon,
	className,
	label,
}: {
	Icon: any;
	className?: string;
	label?: string;
}) {
	return (
		<div className="size-8 bg-white/10 rounded-full p-2 aspect-square shrink-0">
			<Icon
				className={twMerge("w-full h-full", className)}
				aria-label={label}
			/>
		</div>
	);
}

const genericSelectClassNames = {
	base: "!mt-0",
	mainWrapper: "h-10 xl:h-full",
	label: "hidden",
};

export function ContentInteractions({
	abstract,
	onAbstractChange,
	view,
	setView,
	countLabel,
	extraFilters,
	header,
}: {
	abstract: boolean;
	onAbstractChange: (abstract: boolean) => void;
	view: string;
	setView: (view: string) => void;
	countLabel: ReactNode;
	extraFilters: ReactNode;
	header?: ReactNode;
}) {
	const itemsContext = use(ItemsContext);
	const {
		isOpen: isExploreOpen,
		onOpen: onExploreOpen,
		onOpenChange: onExploreOpenChange,
	} = useDisclosure();
	const {
		isOpen: isHelpOpen,
		onOpen: onHelpOpen,
		onOpenChange: onHelpOpenChange,
	} = useDisclosure();
	const [debouncedSearch, _] = useDebounce(
		itemsContext.handleSearchChange,
		0
	);
	const actuallyNoData =
		(!itemsContext.isItemsLoading &&
			itemsContext.itemsData &&
			itemsContext.itemsData.items.length === 0) ||
		itemsContext.itemsError;
	const t = useTranslations("ui");
	const tSorts = useTranslations("sorts");
	const tScopes = useTranslations("scopes");
	const formatter = useFormatter();

	function SortComponent() {
		return (
			<Select
				startContent={<DropDownIcon label="Sort icon" Icon={FaSort} />}
				selectedKeys={
					itemsContext.queryParams.sort && [
						itemsContext.queryParams.sort,
					]
				}
				onSelectionChange={itemsContext.handleSortChange as any}
				items={SORT_OPTIONS}
				selectorIcon={<div className="hidden"></div>}
				classNames={
					!itemsContext.userData
						? {
								base: twMerge(
									"flex-1 max-w-full xl:max-w-56 shrink-0",
									genericSelectClassNames.base
								),
								mainWrapper: twMerge(
									"h-full",
									genericSelectClassNames.mainWrapper
								),
								label: twMerge(
									"",
									genericSelectClassNames.label
								),
						  }
						: {
								base: twMerge(
									"flex-1 max-w-full min-w-0 xl:min-w-56",
									genericSelectClassNames.base
								),
								mainWrapper: twMerge(
									"",
									genericSelectClassNames.mainWrapper
								),
								label: twMerge(
									"",
									genericSelectClassNames.label
								),
						  }
				}
				label={"Sort by"}
				labelPlacement="outside"
			>
				{(item: any) => {
					return (
						<SelectItem
							aria-label={tSorts(item.key)}
							key={item.key}
						>
							{tSorts(item.key)}
						</SelectItem>
					);
				}}
			</Select>
		);
	}

	function ScopeComponent() {
		return (
			<Select
				startContent={
					<DropDownIcon label="Scope icon" Icon={GiArchiveResearch} />
				}
				color="tertiary"
				selectedKeys={
					itemsContext.queryParams.scope && [
						itemsContext.queryParams.scope,
					]
				}
				onSelectionChange={itemsContext.handleScopeChange as any}
				items={SCOPE_OPTIONS}
				selectorIcon={<div className="hidden"></div>}
				classNames={
					!itemsContext.userData
						? {
								base: twMerge(
									"xl:max-w-72 w-full max-w-full",
									genericSelectClassNames.base
								),
								mainWrapper: twMerge(
									"h-10 xl:h-full",
									genericSelectClassNames.mainWrapper
								),
								label: twMerge(
									"",
									genericSelectClassNames.label
								),
						  }
						: {
								base: twMerge(
									"flex-1 max-w-full min-w-0 xl:min-w-56",
									genericSelectClassNames.base
								),
								mainWrapper: twMerge(
									"",
									genericSelectClassNames.mainWrapper
								),
								label: twMerge(
									"",
									genericSelectClassNames.label
								),
						  }
				}
				label={"Search scope"}
				labelPlacement="outside"
			>
				{(item: any) => {
					return (
						<SelectItem
							aria-label={tScopes(item.key)}
							key={item.key}
						>
							{tScopes(item.key)}
						</SelectItem>
					);
				}}
			</Select>
		);
	}

	return (
		<>
			{(!itemsContext.userData || header) && (
				<div className="flex w-full flex-col xl:flex-row xl:justify-between xl:items-end h-24 xl:h-12 gap-4 relative">
					<h1 className="text-black dark:text-white/60 font-medium text-2xl xl:text-3xl w-full xl:w-auto h-10 xl:h-12 flex justify-between items-end">
						{header || (
							<>
								<a
									href="#collections"
									className="p-3 text-center w-1 h-1 absolute top-0 left-[-999px] z-[-999] focus:z-[999] focus:left-0 opacity-0 focus:w-fit focus:h-fit focus:opacity-100 bg-background_light dark:bg-background"
								>
									{t("goToFilters")}
								</a>
								{t("searchTitle")}
							</>
						)}
						<Button
							startContent={
								<AiOutlineCompass className="size-6" />
							}
							className="xl:hidden ml-auto rtl:ml-0 rtl:mr-auto h-full"
							onPress={onExploreOpen}
						>
							{t("explore")}
						</Button>
						<FullScreenModal
							scrollBehavior="outside"
							isOpen={isExploreOpen}
							onOpenChange={onExploreOpenChange}
						>
							<ModalContent>
								{(onClose: any) => (
									<>
										<GenericHeader onClose={onClose}>
											{t("explore")}
										</GenericHeader>
										{!itemsContext.userData && (
											<CollectionsList
												data={
													itemsContext.collectionsData
												}
												handleCheckboxChange={
													itemsContext.handleCheckboxChange
												}
												selectedCollections={
													itemsContext.selectedCollections
												}
												hierarchy={
													itemsContext.hierarchy!
												}
												isModal
												range={
													itemsContext.queryParams
														.range
												}
												handleRangeChange={
													itemsContext.handleRangeChange
												}
												facetDistribution={
													itemsContext.itemsData
														?.facetDistribution
												}
											/>
										)}
									</>
								)}
							</ModalContent>
						</FullScreenModal>
					</h1>
					<div className="flex gap-4 h-10 xl:h-12 flex-1 justify-end">
						{!itemsContext.userData && (
							<>
								<Button
									className="h-full font-medium text-base !p-0"
									isIconOnly
									onPress={onHelpOpen}
									aria-label={t("helpAriaLabel")}
								>
									<BiHelpCircle
										aria-label={t("helpIconAriaLabel")}
										className="size-6"
									/>
								</Button>
								<HelpModal
									isOpen={isHelpOpen}
									onOpenChange={onHelpOpenChange}
								/>
								{<SortComponent />}
							</>
						)}
					</div>
				</div>
			)}
			<section
				role="search"
				className={twMerge(
					"xl:flex xl:flex-row gap-4",
					!itemsContext.userData
						? "flex flex-col"
						: "grid grid-cols-2"
				)}
			>
				<Input
					autoCorrect="off"
					defaultValue={itemsContext.queryParams.search}
					onChange={(e) => debouncedSearch(e.target.value)}
					onClear={() => debouncedSearch("")}
					placeholder={t("search")}
					size={"lg"}
					classNames={{
						inputWrapper: "h-10 xl:h-12 min-h-10 xl:min-h-12",
						base: "col-span-2",
					}}
					isClearable
					startContent={
						<IoSearch
							aria-label={t("searchIconAriaLabel")}
							className="size-6 fill-current text-black/60 dark:text-white/40"
						/>
					}
				/>
				{<ScopeComponent />}
				{itemsContext.userData && <SortComponent />}
				{extraFilters}
			</section>
			<section className="flex justify-between h-10 xl:h-12 gap-4">
				<Skeleton
					isLoaded={!!itemsContext.itemsData}
					className="flex items-center flex-1 rounded-2xl"
				>
					<h2
						suppressHydrationWarning
						className="text-black dark:text-white/80 text-lg leading-[1.125rem] flex items-center whitespace-pre"
					>
						{countLabel ||
							t.rich("resourcesCount", {
								count: formatter.number(
									actuallyNoData
										? 0
										: itemsContext.itemsData?.totalItems ||
												0
								),
								number: (chunks) => (
									<span
										suppressHydrationWarning
										className="text-2xl leading-6"
									>
										{chunks}{" "}
									</span>
								),
							})}
						{itemsContext.isItemsFetching && (
							<div className="relative ltr:ml-3 rtl:mr-3 flex items-center">
								<Spinner
									size="sm"
									className="opacity-60 absolute"
								/>
							</div>
						)}
					</h2>
				</Skeleton>
				<section className="xl:min-w-72 flex gap-4">
					<Card className="h-full flex items-center justify-center flex-1 min-w-0 px-0">
						<div className="px-3">
							<Switch
								size="sm"
								isSelected={abstract}
								onValueChange={onAbstractChange}
								classNames={{
									base: "flex-row-reverse",
								}}
							>
								{t("abstract")}
							</Switch>
						</div>
					</Card>
					<div className="hidden xl:flex gap-0 w-28">
						<Button
							color={view === "list" ? "tertiary" : "secondary"}
							isIconOnly
							className="!p-0 rounded-r-none flex-1"
							onPress={() => setView("list")}
							aria-label={t("viewAsListAriaLabel")}
						>
							<HiOutlineViewList
								aria-label={t("viewAsListAriaLabel")}
								className="size-6"
							/>
						</Button>
						<Button
							color={view === "grid" ? "tertiary" : "secondary"}
							isIconOnly
							className="!p-0 rounded-l-none flex-1"
							onPress={() => setView("grid")}
							aria-label={t("viewAsGridAriaLabel")}
						>
							<IoGrid
								aria-label={t("viewAsGridAriaLabel")}
								className="size-4"
							/>
						</Button>
					</div>
				</section>
			</section>
		</>
	);
}

function MainContent() {
	const props = useItemsList();

	return (
		<>
			<CollectionsList
				data={props.collectionsData}
				handleCheckboxChange={props.handleCheckboxChange}
				selectedCollections={props.selectedCollections}
				hierarchy={props.hierarchy}
				range={props.queryParams.range}
				handleRangeChange={props.handleRangeChange}
				facetDistribution={props.itemsData?.facetDistribution}
			/>
			<ItemsList props={props} />
		</>
	);
}

export default function EvidenceLibrary() {
	const t = useTranslations("ai");
	const { modelObject: { icon: Icon }, selectedModel, setSelectedModel } = useSelectedModel();
	const { isOpen: isChatOpen, onOpen: onChatOpen, onOpenChange: onChatOpenChange } = useDisclosure();
	const { isOpen: isModelOpen, onOpen: onModelOpen, onOpenChange: onModelOpenChange } = useDisclosure();
	const [externalInput, setExternalInput] = useState<string>("");
	
	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onChatOpen();
	}

	return (
		<PageContainer>
			<ModelSelector isOpen={isModelOpen} onOpenChange={onModelOpenChange} selectedModel={selectedModel} onModelChange={setSelectedModel} />
			<ChatModal isOpen={isChatOpen} onOpenChange={onChatOpenChange} modelIndex={selectedModel} externalInput={externalInput} setExternalInput={setExternalInput} />
			<div className="flex gap-[40px] flex-col xl:flex-row">
				<MainContent />
			</div>
			<form onSubmit={handleSubmit} className="fixed bottom-0 left-0 right-0 flex justify-center p-4 items-center z-50 group fill-white">
				<Input
					autoComplete="off"
					value={externalInput}
					onValueChange={setExternalInput}
					startContent={
					<Button isIconOnly variant="invisible" className="shrink-0" onPress={onModelOpen}>
						<Icon className="size-6 bg-accent rounded-full p-1 aspect-square shrink-0" />
					</Button>
					}
					placeholder={t("askAI")}
					classNames={{
						inputWrapper: "p-2 xl:p-2 backdrop-blur-xl shadow-accent-glow data-[hover]:scale-105 max-w-64 data-[focus]:max-w-[28rem] !transition-all !duration-500 ease-bounce-custom mx-auto",
					}}
				/>
				<div className="size-96 bg-accent/50 opacity-0 group-hover:opacity-75 rounded-full blur-3xl absolute translate-y-1/2 -z-10 transition-all duration-1000 ease-spring">
				</div>
			</form>
		</PageContainer>
	);
}
