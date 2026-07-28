"use client";
import { Button } from "@/components/nextui/Button";
import CollectionsList from "@/components/features/collections/CollectionsList";
import ExploreModal from "@/components/features/collections/ExploreModal";
import {
	IoChatboxOutline,
	IoChatbubblesOutline,
	IoGrid,
	IoSearch,
	IoSend,
} from "react-icons/io5";
import { Select } from "@/components/nextui/Select";
import { Input } from "@/components/nextui/Input";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import {
	Divider,
	Modal,
	ModalBody,
	ModalContent,
	ModalFooter,
	PropsOf,
	ScrollShadow,
	Spinner,
	Textarea,
	Tooltip,
	useDisclosure,
} from "@nextui-org/react";
import React, {
	ReactNode,
	use,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Tabs, Tab } from "@nextui-org/react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { AiOutlineCompass } from "react-icons/ai";
import { useDebounce } from "@/hooks/useDebounce";
import { SORT_OPTIONS } from "@/constants/items";
import HelpModal from "@/components/features/modals/HelpModal";
import { useFormatter, useTranslations } from "next-intl";
import {
	GiArchiveResearch,
	GiConsoleController,
	GiStarSwirl,
} from "react-icons/gi";
import { FaSort } from "react-icons/fa";
import { HiOutlineViewList } from "react-icons/hi";
import { BiHelpCircle, BiTrash } from "react-icons/bi";
import { twMerge } from "tailwind-merge";
import PageContainer from "../layout/PageContainer";
import FullScreenModal from "../nextui/FullScreenModal";
import GenericHeader from "../features/modals/GenericHeader";
import { useItemsList } from "@/hooks/useItemsList";
import ItemsList, { ItemsContext } from "../features/items/ItemsList";
import { SearchBar } from "@/components/features/SearchBar";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import ChatModal, { ChatMode } from "../features/modals/ChatModal";
import ModelSelector from "../features/ai/ModelSelector";
import DialogModal from "../nextui/DialogModal";
import AIHeader from "../features/ai/AIHeader";
import { useLocalStorage } from "usehooks-ts";
import { AnimatePresence, motion } from "framer-motion";
import { useModalError } from "@/hooks/useModalError";
import { z } from "zod";
import { Props } from "next/script";
import { toast } from "@/components/layout/Toast";
import { Formatter } from "recharts/types/component/DefaultTooltipContent";
import { BsStars } from "react-icons/bs";
import useBreakpoint, { useBreakpointBelow } from "@/hooks/useBreakpoint";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { getRuntimeSearchScopeOptions } from "@/config/library-config/search";

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
	mainWrapper: "h-10 lg:h-full",
	label: "hidden",
};

// SearchBar now lives in "@/components/features/SearchBar".
// Re-exported here so existing consumers (e.g. Map) can keep importing it from this module.
export { SearchBar };

function SortComponent({
	itemsContext,
}: {
	itemsContext: ReturnType<typeof useItemsList>;
}) {
	const tSorts = useTranslations("sorts");

	return (
		<Select
			startContent={<DropDownIcon label="Sort icon" Icon={FaSort} />}
			selectedKeys={
				itemsContext.queryParams.sort && [itemsContext.queryParams.sort]
			}
			onSelectionChange={itemsContext.handleSortChange as any}
			items={SORT_OPTIONS}
			selectorIcon={<div className="hidden"></div>}
			classNames={
				!itemsContext.userData &&
				itemsContext.config.interactionsStyle !== "one-line"
					? {
							base: twMerge(
								"flex-1 max-w-full lg:max-w-56 shrink-0",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"h-full",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
					: {
							base: twMerge(
								"flex-1 max-w-full min-w-0 lg:min-w-56",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
			}
			label={"Sort by"}
			labelPlacement="outside"
		>
			{(item: any) => {
				return (
					<SelectItem aria-label={tSorts(item.key)} key={item.key}>
						{tSorts(item.key)}
					</SelectItem>
				);
			}}
		</Select>
	);
}

function ScopeComponent({
	itemsContext,
}: {
	itemsContext: ReturnType<typeof useItemsList>;
}) {
	const tScopes = useTranslations("scopes");
	const { search } = useLibraryConfig();
	const scopeOptions = useMemo(
		() => getRuntimeSearchScopeOptions(search),
		[search],
	);

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
			items={scopeOptions}
			selectorIcon={<div className="hidden"></div>}
			classNames={
				!itemsContext.userData
					? {
							base: twMerge(
								"lg:max-w-72 max-w-full",
								itemsContext.config.interactionsStyle ===
									"one-line" && "flex-1",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"h-10 lg:h-full",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
					: {
							base: twMerge(
								"flex-1 max-w-full min-w-0 lg:min-w-56",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
			}
			label={"Search scope"}
			labelPlacement="outside"
		>
			{(item: any) => {
				return (
					<SelectItem aria-label={tScopes(item.key)} key={item.key}>
						{tScopes(item.key)}
					</SelectItem>
				);
			}}
		</Select>
	);
}

function SearchTabContent({
	header,
	itemsContext,
	extraFilters,
	countLabel,
	abstract,
	onAbstractChange,
	view,
	setView,
	showHeader,
}: {
	header: ReactNode;
	itemsContext: ReturnType<typeof useItemsList>;
	extraFilters: ReactNode;
	countLabel: ReactNode;
	abstract: boolean;
	onAbstractChange: (abstract: boolean) => void;
	view: string;
	setView: (view: string) => void;
	showHeader: boolean;
}) {
	const t = useTranslations("ui");
	const tAI = useTranslations("ai");
	const formatter = useFormatter();

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

	const actuallyNoData =
		(!itemsContext.isItemsLoading &&
			itemsContext.itemsData &&
			itemsContext.itemsData.items.length === 0) ||
		itemsContext.itemsError;

	return (
		<div className="flex flex-col gap-4">
			{/* Header with title and explore button */}
			<div className="flex w-full flex-col lg:flex-row lg:justify-between lg:items-end h-24 lg:h-12 gap-4 relative">
				<h1 className="text-black dark:text-white/60 font-medium text-2xl lg:text-3xl w-full lg:w-auto h-10 lg:h-12 flex justify-between items-end">
					<div className="flex items-end gap-4">
						{header || (
							<>
								<a
									href="#collections"
									className="p-3 text-center w-1 h-1 absolute top-0 left-[-999px] z-[-999] focus:z-[999] focus:left-0 opacity-0 focus:w-fit focus:h-fit focus:opacity-100 bg-background_light dark:bg-background"
								>
									{t("goToFilters")}
								</a>
								{showHeader && t("searchTitle")}
							</>
						)}
						{!showHeader && <SearchModeSwitch mode={"search"} />}
					</div>
					<Button
						startContent={
							<AiOutlineCompass className="size-6 shrink-0" />
						}
						className="lg:hidden ml-auto rtl:ml-0 rtl:mr-auto h-full"
						onPress={onExploreOpen}
					>
						{t("explore")}
					</Button>
					<ExploreModal
						isOpen={isExploreOpen}
						onOpenChange={onExploreOpenChange}
					/>
				</h1>
				<div className="flex gap-4 h-10 lg:h-12 flex-1 justify-end">
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
							{<SortComponent itemsContext={itemsContext} />}
						</>
					)}
				</div>
			</div>

			{/* Search and filters */}
			{itemsContext.config.interactionsStyle === "one-line" ? (
				<div className="flex gap-4">
					<ScopeComponent itemsContext={itemsContext} />
					<SortComponent itemsContext={itemsContext} />
				</div>
			) : (
				<section
					role="search"
					className={twMerge(
						"lg:flex lg:flex-row gap-4",
						!itemsContext.userData
							? "flex flex-col"
							: "grid grid-cols-2",
					)}
				>
					<SearchBar
						handleSearchChange={itemsContext.handleSearchChange}
						search={itemsContext.queryParams.search}
					/>
					{<ScopeComponent itemsContext={itemsContext} />}
					{itemsContext.userData && (
						<SortComponent itemsContext={itemsContext} />
					)}
					{extraFilters}
				</section>
			)}

			{/* Results count and view controls */}
			<section className="flex justify-between h-10 lg:h-12 gap-8">
				<Skeleton
					isLoaded={!!itemsContext.itemsData}
					className="flex items-center flex-1 rounded-2xl"
				>
					<h2
						suppressHydrationWarning
						className="text-black dark:text-white/80 text-lg leading-[1.125rem] flex items-center whitespace-pre relative"
					>
						<div className="flex flex-col md:flex-row md:items-center items-start md:gap-2 whitespace-normal">
							{countLabel ||
								t.rich("resourcesCount", {
									count: formatter.number(
										actuallyNoData
											? 0
											: itemsContext.itemsData
													?.totalItems || 0,
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
						</div>
						{itemsContext.isItemsFetching && (
							<div className="flex items-center !size-0 absolute ltr:-right-4 rtl:-left-4 translate-x-full">
								<Spinner
									size="sm"
									className="opacity-60 absolute"
								/>
							</div>
						)}
					</h2>
				</Skeleton>
				<section
					className={twMerge(
						"flex gap-4",
						itemsContext.config.interactionsStyle === "multi-line"
							? "lg:min-w-72"
							: "flex-1",
					)}
				>
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
					{!itemsContext.config.disableViewSwitch && (
						<div className="hidden lg:flex gap-0 w-28">
							<Button
								color={
									view === "list" ? "tertiary" : "secondary"
								}
								isIconOnly
								className="!p-0 ltr:rounded-r-none rtl:rounded-l-none flex-1"
								onPress={() => setView("list")}
								aria-label={t("viewAsListAriaLabel")}
							>
								<HiOutlineViewList
									aria-label={t("viewAsListAriaLabel")}
									className="size-6"
								/>
							</Button>
							<Button
								color={
									view === "grid" ? "tertiary" : "secondary"
								}
								isIconOnly
								className="!p-0 ltr:rounded-l-none rtl:rounded-r-none flex-1"
								onPress={() => setView("grid")}
								aria-label={t("viewAsGridAriaLabel")}
							>
								<IoGrid
									aria-label={t("viewAsGridAriaLabel")}
									className="size-4"
								/>
							</Button>
						</div>
					)}
				</section>
			</section>
		</div>
	);
}

function AITabContent({
	onSwitchToSearch,
	onChatOpen,
	externalInput,
	setExternalInput,
}: {
	onSwitchToSearch: () => void;
	onChatOpen: () => void;
	externalInput: string;
	setExternalInput: (input: string) => void;
}) {
	const {
		providerPresentation: { icon: Icon },
		selectedProviderId,
		setSelectedProvider,
	} = useSelectedModel();

	const {
		isOpen: isModelOpen,
		onOpen: onModelOpen,
		onOpenChange: onModelOpenChange,
	} = useDisclosure();
	const {
		isOpen: isSmartScreeningOpen,
		onOpen: onSmartScreeningOpen,
		onOpenChange: onSmartScreeningOpenChange,
	} = useDisclosure();
	const [mode, setMode] = useLocalStorage<ChatMode>("chat-mode", "full");
	const { isDeepResearchEnabled } = useIsAISearchEnabled();
	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onChatOpen();
	};

	const tAI = useTranslations("ai");
	const tUI = useTranslations("ui");
	const t = useTranslations("ui");

	return (
		<div className="flex flex-col gap-4 lg:pb-2 lg:pt-0 py-[2.375rem]">
			<ModelSelector
				isOpen={isModelOpen}
				onOpenChange={onModelOpenChange}
				selectedProvider={selectedProviderId}
				onProviderChange={setSelectedProvider}
			/>

			{isSmartScreeningOpen ? (
				<SmartScreeningModal
					isOpen
					onOpenChange={onSmartScreeningOpenChange}
				/>
			) : null}

			<div className="flex items-end justify-start h-12">
				<div className="flex items-end gap-4">
					{/* <h1 className="text-black dark:text-white/60 font-medium text-2xl lg:text-3xl">
						{tAI("askAI") || "Ask AI"}
					</h1> */}
					<SearchModeSwitch mode={"ai"} />
				</div>
			</div>

			<form
				onSubmit={handleSubmit}
				className="flex justify-center items-center gap-4"
			>
				<div className="flex gap-4 w-full items-center">
					<Tooltip content={t("openChatTooltip")}>
						<Button
							isIconOnly
							startContent={<IoChatboxOutline />}
							size="md"
							className="!p-0"
							onPress={onChatOpen}
						></Button>
					</Tooltip>
					<div className="relative flex-1">
						<Input
							autoComplete="off"
							value={externalInput}
							onValueChange={setExternalInput}
							startContent={
								<Button
									isIconOnly
									variant="invisible"
									className="shrink-0"
									onPress={onModelOpen}
								>
									<Icon className="size-6 bg-accent rounded-full p-1 aspect-square shrink-0 fill-white" />
								</Button>
							}
							endContent={
								<div className="flex items-center gap-1">
									{isDeepResearchEnabled && (
										<Tooltip
											content={tUI("researchModeTooltip")}
										>
											<Button
												isIconOnly
												size="sm"
												variant="default"
												className="shrink-0"
												onPress={() =>
													setMode(
														mode === "full"
															? "quick"
															: "full",
													)
												}
												aria-label={tUI("researchMode")}
											>
												<GiArchiveResearch
													className={twMerge(
														"size-4",
														mode === "full"
															? "text-accent"
															: "text-black/60 dark:text-white/60",
													)}
												/>
											</Button>
										</Tooltip>
									)}
									<Button
										type="submit"
										isIconOnly
										variant="default"
										className="shrink-0"
										size="sm"
										onPress={onChatOpen}
									>
										<IoSend className="size-4" />
									</Button>
								</div>
							}
							placeholder={tAI("askMeAnythingPublications")}
							className="w-full"
							classNames={{
								inputWrapper:
									"h-12 p-3 rounded-2xl border bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
								input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base",
							}}
						/>
					</div>
					<Tooltip content={t("smartScreening")}>
						<Button
							isIconOnly
							startContent={<GiStarSwirl />}
							size="md"
							className="!p-0"
							onPress={onSmartScreeningOpen}
						></Button>
					</Tooltip>
				</div>
			</form>

			<div className="text-start text-sm text-black/60 dark:text-white/40 mr-auto">
				{tAI("aiDescription") ||
					"Ask questions about the evidence library or get help with your research. "}
			</div>
		</div>
	);
}

export type SearchMode = "search" | "ai" | "research";

export function useIsAISearchEnabled() {
	const isAISearchEnabled = useLibraryFeature("aiSearch");
	const isDeepResearchEnabled =
		useLibraryFeature("deepResearch");
	return {
		isAISearchEnabled,
		isDeepResearchEnabled,
	};
}

function useSelectedSearchMode(
	mode: ChatMode,
	selectedTab: SearchMode,
	isAISearchEnabled: boolean,
) {
	if (selectedTab === "search" || !isAISearchEnabled) return "search";
	if (selectedTab === "ai") return mode === "full" ? "research" : "ai";
	return "search";
}

export function useSearchMode() {
	const t = useTranslations("ui");
	const tAI = useTranslations("ai");
	const [selectedTabOriginal, setSelectedTab] = useLocalStorage<SearchMode>(
		"selectedSearchTab",
		"search",
	);
	const [mode, setMode] = useLocalStorage<ChatMode>("chat-mode", "full");
	const { isAISearchEnabled, isDeepResearchEnabled } = useIsAISearchEnabled();

	const selectedTab = useSelectedSearchMode(
		mode,
		selectedTabOriginal,
		isAISearchEnabled,
	);

	const tabData: Record<
		SearchMode,
		{
			text: string;
			tooltip: string;
			icon: ReactNode;
			action: () => void;
			disabled: boolean;
		}
	> = {
		search: {
			text: t("search"),
			tooltip: t("searchTooltip"),
			icon: <IoSearch className="size-5" />,
			action: () => setSelectedTab("search"),
			disabled: false,
		},
		ai: {
			text: t("quickAnswer"),
			tooltip: t("quickAnswerTooltip"),
			icon: <BsStars className="size-5" />,
			action: () => {
				setMode("quick");
				setSelectedTab("ai");
			},
			disabled: !isAISearchEnabled,
		},
		research: {
			text: t("deepResearch"),
			tooltip: t("deepResearchTooltip"),
			icon: <GiArchiveResearch className="size-5" />,
			action: () => {
				setMode("full");
				setSelectedTab("ai");
			},
			disabled: !isDeepResearchEnabled,
		},
	};

	const activeCount = Object.keys(tabData).filter(
		(mode) => !tabData[mode as SearchMode].disabled,
	).length;

	return { selectedTab, tabData, setSelectedTab, activeCount };
}

function SearchModeSwitch({ mode: selectedTab }: { mode: SearchMode }) {
	const t = useTranslations("ui");
	const { tabData } = useSearchMode();
	const isMobile = useBreakpointBelow("lg");
	const isReallySmall = useBreakpointBelow(null, "400px");

	return (
		<div className="flex gap-2">
			{Object.keys(tabData).map((mode) => (
				<Tooltip
					content={tabData[mode as SearchMode].tooltip}
					key={mode}
				>
					{!tabData[mode as SearchMode].disabled && (
						<Button
							key={mode}
							startContent={tabData[mode as SearchMode].icon}
							className={twMerge(
								"h-10",
								isMobile &&
									(mode === selectedTab || isReallySmall) &&
									"!min-w-0 !aspect-square !p-0",
							)}
							variant="light"
							color={
								mode === selectedTab ? "accent" : "secondary"
							}
							onPress={() => tabData[mode as SearchMode].action()}
						>
							<span
								className={twMerge(
									isMobile &&
										(mode === selectedTab ||
											isReallySmall) &&
										"hidden",
								)}
							>
								{tabData[mode as SearchMode].text}
							</span>
						</Button>
					)}
				</Tooltip>
			))}
		</div>
	);
}

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
	const { selectedTab, setSelectedTab, activeCount } = useSearchMode();
	const {
		isOpen: isChatOpen,
		onOpen: onChatOpen,
		onOpenChange: onChatOpenChange,
	} = useDisclosure();
	const {
		providerPresentation: { icon: Icon },
		selectedProviderId,
	} = useSelectedModel();
	const [externalInput, setExternalInput] = useState<string>("");

	return (
		<div className="relative">
			<ChatModal
				isOpen={isChatOpen}
				onOpenChange={onChatOpenChange}
				provider={selectedProviderId}
				externalInput={externalInput}
				setExternalInput={setExternalInput}
			/>
			<AnimatePresence mode="wait">
				{selectedTab === "search" && (
					<motion.div
						key="search-content"
						initial={{ opacity: 0, x: -20, scale: 0.95 }}
						animate={{ opacity: 1, x: 0, scale: 1 }}
						exit={{ opacity: 0, x: 20, scale: 0.95 }}
						transition={{
							duration: 0.4,
							ease: [0.25, 0.46, 0.45, 0.94], // Custom easing for smooth animation
						}}
						className="w-full p-1"
					>
						<SearchTabContent
							header={header}
							itemsContext={itemsContext}
							extraFilters={extraFilters}
							countLabel={countLabel}
							abstract={abstract}
							onAbstractChange={onAbstractChange}
							view={view}
							setView={setView}
							showHeader={activeCount === 1}
						/>
					</motion.div>
				)}
				{selectedTab === "ai" && (
					<motion.div
						key="ai-content"
						initial={{ opacity: 0, x: 20, scale: 0.95 }}
						animate={{ opacity: 1, x: 0, scale: 1 }}
						exit={{ opacity: 0, x: -20, scale: 0.95 }}
						transition={{
							duration: 0.4,
							ease: [0.25, 0.46, 0.45, 0.94], // Custom easing for smooth animation
						}}
						className="w-full p-1"
					>
						<AITabContent
							onSwitchToSearch={() => setSelectedTab("search")}
							onChatOpen={onChatOpen}
							externalInput={externalInput}
							setExternalInput={setExternalInput}
						/>
					</motion.div>
				)}

				{selectedTab === "research" && (
					<motion.div
						key="research-content"
						initial={{ opacity: 0, x: 20, scale: 0.95 }}
						animate={{ opacity: 1, x: 0, scale: 1 }}
						exit={{ opacity: 0, x: -20, scale: 0.95 }}
						transition={{
							duration: 0.4,
							ease: [0.25, 0.46, 0.45, 0.94], // Custom easing for smooth animation
						}}
						className="w-full p-1"
					>
						<AITabContent
							onSwitchToSearch={() => setSelectedTab("search")}
							onChatOpen={onChatOpen}
							externalInput={externalInput}
							setExternalInput={setExternalInput}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
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
				facetDistribution={props.facetDistribution}
				queryParams={props.queryParams}
				handleInstitutionSelect={props.handleInstitutionSelect}
				handleCountrySelect={props.handleCountrySelect}
				handleAuthorCountrySelect={props.handleAuthorCountrySelect}
			/>
			<ItemsList props={props} />
		</>
	);
}

const smartScreeningFieldTypes = ["string", "number", "boolean"] as const;

export type SmartScreeningField = {
	label: string;
	description: string;
	type: (typeof smartScreeningFieldTypes)[number];
};

function SmartScreeningModal({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("ui");
	const tabs = ["fields", "text"] as const;
	const labels = [t("fields"), t("textLabel")] as const;
	const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
	const [fields, setFields] = useLocalStorage<SmartScreeningField[]>(
		"smart-screening-fields",
		[],
	);
	const [localFields, setLocalFields] = useState<SmartScreeningField[]>(
		() => [...fields],
	);
	const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
	const placeholderExample = `${t("label")} (${smartScreeningFieldTypes.join(
		" | ",
	)}): ${t("description")}`;

	const fieldSchema = z.object({
		label: z.string().min(1, t("labelRequired")).max(64, t("labelTooLong")),
		type: z.enum(["string", "number", "boolean"]),
		description: z
			.string()
			.min(1, t("descriptionRequired"))
			.max(1024, t("descriptionTooLong")),
	});

	const convertedText = fields
		.map(
			(field) =>
				`${field.label.trim()} (${
					field.type
				}): ${field.description.trim()}`,
		)
		.join("\n");

	const validatorFunction = (localFields: SmartScreeningField[]) => {
		const newErrors: Record<number, string> = {};
		let hasErrors = false;

		// Check for duplicate labels
		const labelCounts: Record<string, number[]> = {};
		localFields.forEach((field, index) => {
			const label = field.label.trim();
			if (label) {
				if (!labelCounts[label]) {
					labelCounts[label] = [];
				}
				labelCounts[label].push(index);
			}
		});

		// Mark duplicate labels as errors
		Object.entries(labelCounts).forEach(([label, indices]) => {
			if (indices.length > 1) {
				indices.forEach((index) => {
					newErrors[index] = `${t("fieldPrefix")} ${
						index + 1
					} ${label}: ${t("duplicateLabelError")}`;
					hasErrors = true;
				});
			}
		});

		// Validate each field with Zod schema
		localFields.forEach((field, index) => {
			if (!newErrors[index]) {
				// Only validate if not already marked as duplicate
				try {
					fieldSchema.parse(field);
				} catch (error) {
					if (error instanceof z.ZodError) {
						const fieldError =
							error.issues[0]?.message || t("invalidField");
						newErrors[index] = `${t("fieldPrefix")} ${index + 1} ${
							field.label
						}: ${fieldError}`;
						hasErrors = true;
					}
				}
			}
		});

		setFieldErrors(newErrors);

		if (!hasErrors) {
			setFields(localFields);
			toast({
				title: t("fieldsSavedSuccess"),
				description: t("fieldsSavedSuccess"),
			});
		} else {
			toast({
				title: "Please fix the errors in the fields",
				description: Object.values(newErrors).join("\n"),
			});
		}
	};

	const handleFieldsSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		validatorFunction(localFields);
	};

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.target as HTMLFormElement);
		const text = formData.get("text");
		const localFields: SmartScreeningField[] = [];
		const lines = text?.toString().split("\n");
		if (lines) {
			lines.forEach((line) => {
				const [key, ...rest] = line.split(":");
				const [label, typeWithParentheses] = key?.split("(") || [];
				const [type, parentheses] =
					typeWithParentheses?.split(")") || [];
				const description = rest.join(":").trim();
				if (line.length > 0) {
					localFields.push({
						label: label?.trim(),
						type: type?.trim() as (typeof smartScreeningFieldTypes)[number],
						description: description?.trim(),
					});
				}
			});
		}
		validatorFunction(localFields);
	};

	return (
		<DialogModal
			size="xl"
			scrollBehavior="inside"
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<ModalContent>
				{(onClose) => (
					<>
						<AIHeader onClose={onClose}>
							{t("smartScreening")}
						</AIHeader>
						<div className="flex gap-0 px-6 py-2">
							{tabs.map((t, i) => (
								<Button
									key={t}
									size="md"
									color={tab === t ? "accent" : "secondary"}
									className={twMerge(
										"rounded-none",
										t === tabs[0] && "rounded-l-2xl",
										t === tabs.at(-1) && "rounded-r-2xl",
									)}
									onPress={() => setTab(t)}
								>
									{labels[i]}
								</Button>
							))}
						</div>
						<ModalBody className="p-0 relative">
							<ScrollShadow className="h-full">
								{tab === "fields" ? (
									<form
										id="fields-form"
										key="fields"
										onSubmit={handleFieldsSubmit}
										className="flex flex-col gap-6"
									>
										<AnimatePresence mode="sync">
											<div
												key="fields"
												className="p-6 flex flex-col gap-6"
											>
												{localFields.length === 0 && (
													<p
														key="empty"
														className="text-center text-black/60 dark:text-white/40 my-12 mt-14"
													>
														{t("noFieldsAdded")}
													</p>
												)}
												{localFields.map(
													(field, index) => (
														<motion.div
															key={index}
															initial={{
																opacity: 0,
																y: 10,
															}}
															animate={{
																opacity: 1,
																y: 0,
															}}
															transition={{
																duration: 0.3,
															}}
															className="flex flex-col gap-2"
														>
															<Input
																isRequired
																placeholder={t(
																	"label",
																)}
																label={t(
																	"label",
																)}
																value={
																	field.label
																}
																isInvalid={
																	!!fieldErrors[
																		index
																	] &&
																	!field.label
																}
																errorMessage={
																	fieldErrors[
																		index
																	] &&
																	!field.label
																		? fieldErrors[
																				index
																			]
																		: undefined
																}
																onChange={(e) =>
																	setLocalFields(
																		localFields.map(
																			(
																				f,
																				i,
																			) =>
																				i ===
																				index
																					? {
																							...f,
																							label: e
																								.target
																								.value,
																						}
																					: f,
																		),
																	)
																}
															/>
															<Textarea
																placeholder={t(
																	"description",
																)}
																label={t(
																	"description",
																)}
																value={
																	field.description
																}
																isRequired={
																	true
																}
																isInvalid={
																	!!fieldErrors[
																		index
																	] &&
																	!field.description
																}
																errorMessage={
																	fieldErrors[
																		index
																	] &&
																	!field.description
																		? fieldErrors[
																				index
																			]
																		: undefined
																}
																onChange={(e) =>
																	setLocalFields(
																		localFields.map(
																			(
																				f,
																				i,
																			) =>
																				i ===
																				index
																					? {
																							...f,
																							description:
																								e
																									.target
																									.value,
																						}
																					: f,
																		),
																	)
																}
																classNames={{
																	inputWrapper:
																		"rounded-2xl border bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
																	input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
																}}
															/>
															<div className="flex justify-between">
																<Select
																	color="tertiary"
																	label={t(
																		"typeLabel",
																	)}
																	placement="left"
																	disallowEmptySelection={
																		true
																	}
																	selectedKeys={
																		field.type
																			? [
																					field.type,
																				]
																			: undefined
																	}
																	isInvalid={
																		!!fieldErrors[
																			index
																		] &&
																		!field.type
																	}
																	errorMessage={
																		fieldErrors[
																			index
																		] &&
																		!field.type
																			? fieldErrors[
																					index
																				]
																			: undefined
																	}
																	onSelectionChange={(
																		value,
																	) => {
																		const selectedType =
																			Array.from(
																				value,
																			)[0] as (typeof smartScreeningFieldTypes)[number];
																		setLocalFields(
																			localFields.map(
																				(
																					f,
																					i,
																				) =>
																					i ===
																					index
																						? {
																								...f,
																								type: selectedType,
																							}
																						: f,
																			),
																		);
																	}}
																>
																	{smartScreeningFieldTypes.map(
																		(
																			type,
																		) => (
																			<SelectItem
																				key={
																					type
																				}
																				value={
																					type
																				}
																			>
																				{
																					type
																				}
																			</SelectItem>
																		),
																	)}
																</Select>
																<Button
																	isIconOnly
																	color="danger"
																	onPress={() =>
																		setLocalFields(
																			localFields.filter(
																				(
																					_,
																					i,
																				) =>
																					i !==
																					index,
																			),
																		)
																	}
																	className="!p-0"
																>
																	<BiTrash className="size-4" />
																</Button>
															</div>
														</motion.div>
													),
												)}
											</div>
										</AnimatePresence>
									</form>
								) : (
									<form
										id="text-form"
										key="text"
										onSubmit={handleSubmit}
										className="flex flex-col gap-6 p-6"
									>
										<AnimatePresence mode="sync">
											<Textarea
												name="text"
												defaultValue={convertedText}
												classNames={{
													inputWrapper:
														"rounded-2xl border bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
													input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
												}}
												placeholder={placeholderExample}
												label={t("textLabel")}
											/>
										</AnimatePresence>
									</form>
								)}
							</ScrollShadow>
						</ModalBody>
						<div
							key="fields-footer"
							className="flex justify-end gap-4 z-10 p-2 rounded-b-2xl"
						>
							{tab === "fields" ? (
								<>
									<Button
										size="md"
										onPress={() =>
											setLocalFields([
												...localFields,
												{
													label: "",
													type: "string",
													description: "",
												},
											])
										}
									>
										{t("addField")}
									</Button>
									<Button
										type="submit"
										form="fields-form"
										color="accent"
										size="md"
									>
										{t("saveFields")}
									</Button>
								</>
							) : (
								<Button type="submit" form="text-form">
									{t("save")}
								</Button>
							)}
						</div>
					</>
				)}
			</ModalContent>
		</DialogModal>
	);
}

export default function EvidenceLibrary() {
	return (
		<PageContainer>
			<div className="flex xl:gap-[2.5rem] gap-8 flex-col lg:flex-row">
				<MainContent />
			</div>
		</PageContainer>
	);
}
