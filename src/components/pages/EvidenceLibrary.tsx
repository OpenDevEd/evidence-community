"use client";
import { SkipLink } from "@/components/layout/SkipLink";

import {
	HugeiconsIcon,
	type IconSvgElement,
} from "@/components/icons/Hugeicon";
import {
	ArchiveIcon,
	BubbleChatIcon,
	Compass01Icon,
	GridViewIcon,
	HelpCircleIcon,
	ListViewIcon,
	Search01Icon,
	SentIcon,
	Sorting01Icon,
	SparklesIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import CollectionsList from "@/components/features/collections/CollectionsList";
import ExploreModal from "@/components/features/collections/ExploreModal";
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
import { useDebounce } from "@/hooks/useDebounce";
import { SORT_OPTIONS } from "@/constants/items";
import HelpModal from "@/components/features/modals/HelpModal";
import { useFormatter, useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import PageContainer from "../layout/PageContainer";
import FullScreenModal from "../nextui/FullScreenModal";
import GenericHeader from "../features/modals/GenericHeader";
import { useItemsList } from "@/hooks/useItemsList";
import ItemsList, { ItemsContext } from "../features/items/ItemsList";
import { SearchBar } from "@/components/features/SearchBar";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import ChatModal, { type ChatWindowHandle } from "../features/modals/ChatModal";
import type { ChatMode } from "@/types/ai";
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
import useBreakpoint, { useBreakpointBelow } from "@/hooks/useBreakpoint";
import { LibraryTagline } from "@/components/library/LibraryTagline";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { getRuntimeSearchScopeOptions } from "@/config/library-config/search";
import { useFiltersContext } from "@/context/FiltersProvider";
import { useAskInlineChat } from "@/components/features/ai/useAskInlineChat";
import { useModEnterHint } from "@/hooks/useShortcutHints";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { useIsAISearchEnabled } from "@/hooks/useAISearchMode";
import { SmartScreeningModal } from "@/components/features/ai/SmartScreeningModal";
import {
	SMART_SCREENING_FIELD_TYPES,
	type SmartScreeningField,
} from "@/types/ai";

function DropDownIcon({
	Icon,
	className,
	label,
}: {
	Icon: IconSvgElement;
	className?: string;
	label?: string;
}) {
	return (
		<div className="size-8 bg-white/10 rounded-full p-2 aspect-square shrink-0">
			<HugeiconsIcon
				icon={Icon}
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
			startContent={
				<DropDownIcon label="Sort icon" Icon={Sorting01Icon} />
			}
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
				<DropDownIcon label="Scope icon" Icon={ArchiveIcon} />
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

/** Hands whatever is in the search field to the assistant. */
function AskAIButton({ hint, onAsk }: { hint: string; onAsk: () => void }) {
	const tAI = useTranslations("ai");

	return (
		// A plain button: press handling inside the search field's own
		// content breaks the one the rest of the site uses.
		<button
			type="button"
			onMouseDown={(event) => event.preventDefault()}
			onClick={onAsk}
			// Smaller on a phone, where the search field is shorter and
			// there is no keyboard to show a shortcut for.
			className="flex h-7 shrink-0 animate-rise-in items-center gap-1 self-center rounded-lg bg-accent px-2.5 text-xs font-medium text-white transition-transform hover:scale-102 active:scale-97 lg:h-9 lg:gap-1.5 lg:rounded-large lg:pl-3 lg:pr-1.5 lg:text-sm"
		>
			<HugeiconsIcon
				icon={SparklesIcon}
				className="size-3.5 shrink-0 lg:size-4"
			/>
			{tAI("askAI")}
			<kbd className="ml-0.5 hidden rounded-md bg-white/20 px-1.5 py-0.5 font-sans text-citation font-medium leading-none text-white/90 lg:inline">
				{hint}
			</kbd>
		</button>
	);
}

/** The search field and the filters beside it. */
function LibraryFilters({
	askAI,
	extraFilters,
	itemsContext,
}: {
	askAI?: (text: string) => boolean;
	extraFilters: ReactNode;
	itemsContext: ReturnType<typeof useItemsList>;
}) {
	// The server does not know the reader's keyboard, so the hint waits.
	const shortcutHint = useModEnterHint();

	if (itemsContext.config.interactionsStyle === "one-line") {
		return (
			<div className="flex gap-4">
				<ScopeComponent itemsContext={itemsContext} />
				<SortComponent itemsContext={itemsContext} />
			</div>
		);
	}

	return (
		<section
			role="search"
			className={twMerge(
				"lg:flex lg:flex-row gap-4",
				itemsContext.userData ? "grid grid-cols-2" : "flex flex-col",
			)}
		>
			<SearchBar
				handleSearchChange={itemsContext.handleSearchChange}
				search={itemsContext.queryParams.search}
				focusOnRequest
				// Asking uses the text as a question, so it must not stay
				// behind as a filter as well. It only leaves the field once
				// the chat has taken it.
				onAsk={
					askAI &&
					((text: string, clear: () => void) => {
						if (askAI(text)) clear();
					})
				}
				trailing={
					askAI && shortcutHint
						? (ask: () => void) => (
								<AskAIButton hint={shortcutHint} onAsk={ask} />
							)
						: undefined
				}
			/>
			<ScopeComponent itemsContext={itemsContext} />
			{itemsContext.userData ? (
				<SortComponent itemsContext={itemsContext} />
			) : null}
			{extraFilters}
		</section>
	);
}

function SearchTabContent({
	askAI,
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
	/** Hand the text in the search field to the assistant instead. */
	askAI?: (text: string) => boolean;
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
								<SkipLink href="#collections">{t("goToFilters")}</SkipLink>
								{showHeader && t("searchTitle")}
							</>
						)}
						{!showHeader && <SearchModeSwitch mode={"search"} />}
					</div>
					<Button
						startContent={
							<HugeiconsIcon
								icon={Compass01Icon}
								className="size-6 shrink-0"
							/>
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
								<HugeiconsIcon
									icon={HelpCircleIcon}
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

			<LibraryTagline show={showHeader} />

			<LibraryFilters
				askAI={askAI}
				extraFilters={extraFilters}
				itemsContext={itemsContext}
			/>

			{/* Results count and view controls */}
			<section className="flex justify-between h-10 lg:h-12 gap-8">
				<Skeleton
					isLoaded={!!itemsContext.itemsData || !!itemsContext.itemsError}
					className="flex items-center flex-1 rounded-2xl"
				>
					{!itemsContext.itemsError && <h2
						suppressHydrationWarning
						className="text-black dark:text-white/80 text-lg leading-none flex items-center whitespace-pre relative"
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
					</h2>}
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
								<HugeiconsIcon
									icon={ListViewIcon}
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
								<HugeiconsIcon
									icon={GridViewIcon}
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

/** The research toggle and send button inside the quick ask box. */
function AskBoxActions({
	isDeepResearchEnabled,
	mode,
	setMode,
}: {
	isDeepResearchEnabled: boolean;
	mode: ChatMode;
	setMode: (mode: ChatMode) => void;
}) {
	const tUI = useTranslations("ui");
	const isResearch = mode === "research";

	return (
		<div className="flex items-center gap-1">
			{isDeepResearchEnabled && (
				<Tooltip content={tUI("researchModeTooltip")}>
					<Button
						isIconOnly
						size="sm"
						variant="default"
						className="shrink-0"
						onPress={() =>
							setMode(isResearch ? "quick" : "research")
						}
						aria-label={tUI("researchMode")}
					>
						<HugeiconsIcon
							icon={ArchiveIcon}
							className={twMerge(
								"size-4",
								isResearch
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
			>
				<HugeiconsIcon icon={SentIcon} className="size-4" />
			</Button>
		</div>
	);
}

/**
 * Opens the full-screen chat window, asking whatever the reader had already
 * typed on the page. The window is built before it is shown, so it can be
 * asked straight away.
 */
function useLibraryChatWindow() {
	const { isOpen, onOpen, onOpenChange } = useDisclosure();
	const chatWindow = useRef<ChatWindowHandle>(null);
	/** Answers whether the question was taken, so it is never lost. */
	const openChatWindow = (question: string) => {
		onOpen();
		if (!question.trim()) return false;

		return chatWindow.current?.ask(question) ?? false;
	};

	return {
		chatWindow,
		isChatOpen: isOpen,
		onChatOpenChange: onOpenChange,
		openChatWindow,
	};
}

function AITabContent({
	askAI,
	onSwitchToSearch,
	onChatOpen,
	externalInput,
	hasChatConversation,
	onModelChange,
	setExternalInput,
}: {
	askAI: (question: string) => boolean;
	onSwitchToSearch: () => void;
	onChatOpen: (question: string) => boolean;
	externalInput: string;
	hasChatConversation: boolean;
	onModelChange: (modelId: string) => void;
	setExternalInput: (input: string) => void;
}) {
	const {
		modelPresentation: { icon: Icon },
		selectedModelId,
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
	const [mode, setMode] = useLocalStorage<ChatMode>("chat-mode", "research");
	const { isDeepResearchEnabled } = useIsAISearchEnabled();
	// The window opens with whatever is already in the field. The field only
	// gives the question up once the window has taken it.
	const handleOpenChat = () => {
		if (onChatOpen(externalInput)) setExternalInput("");
	};
	// Asking a question opens the chat beside the results rather than over
	// them, so the reader keeps their list while they read the answer.
	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (askAI(externalInput)) setExternalInput("");
		onSwitchToSearch();
	};

	const tAI = useTranslations("ai");
	const tUI = useTranslations("ui");
	const t = useTranslations("ui");

	return (
		<div className="flex flex-col gap-4 lg:pb-2 lg:pt-0 py-ai-panel">
			<ModelSelector
				isOpen={isModelOpen}
				onOpenChange={onModelOpenChange}
				selectedModelId={selectedModelId}
				onModelChange={onModelChange}
				hasConversation={hasChatConversation}
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
							startContent={
								<HugeiconsIcon icon={BubbleChatIcon} />
							}
							size="md"
							className="!p-0"
							onPress={handleOpenChat}
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
								<AskBoxActions
									isDeepResearchEnabled={
										isDeepResearchEnabled
									}
									mode={mode}
									setMode={setMode}
								/>
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
							startContent={<HugeiconsIcon icon={SparklesIcon} />}
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

function selectedSearchMode(
	mode: ChatMode,
	selectedTab: SearchMode,
	isAISearchEnabled: boolean,
): SearchMode {
	if (selectedTab !== "ai" || !isAISearchEnabled) return "search";

	return mode === "research" ? "research" : "ai";
}

export function useSearchMode() {
	const t = useTranslations("ui");
	const tAI = useTranslations("ai");
	const [selectedTabOriginal, setSelectedTab] = useLocalStorage<SearchMode>(
		"selectedSearchTab",
		"search",
	);
	const [mode, setMode] = useLocalStorage<ChatMode>("chat-mode", "research");
	const { isAISearchEnabled, isDeepResearchEnabled } = useIsAISearchEnabled();

	const selectedTab = selectedSearchMode(
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
			icon: <HugeiconsIcon icon={Search01Icon} className="size-5" />,
			action: () => setSelectedTab("search"),
			disabled: false,
		},
		ai: {
			text: t("quickAnswer"),
			tooltip: t("quickAnswerTooltip"),
			icon: <HugeiconsIcon icon={SparklesIcon} className="size-5" />,
			action: () => {
				setMode("quick");
				setSelectedTab("ai");
			},
			disabled: !isAISearchEnabled,
		},
		research: {
			text: t("deepResearch"),
			tooltip: t("deepResearchTooltip"),
			icon: <HugeiconsIcon icon={ArchiveIcon} className="size-5" />,
			action: () => {
				setMode("research");
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

/** One tab's content, sliding in from the side it belongs to. */
function ContentTabPanel({
	children,
	fromLeft,
}: {
	children: ReactNode;
	fromLeft?: boolean;
}) {
	const offset = fromLeft ? -20 : 20;

	return (
		<motion.div
			initial={{ opacity: 0, x: offset, scale: 0.95 }}
			animate={{ opacity: 1, x: 0, scale: 1 }}
			exit={{ opacity: 0, x: -offset, scale: 0.95 }}
			transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
			className="w-full p-1"
		>
			{children}
		</motion.div>
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
		modelPresentation: { icon: Icon },
		selectedModelId,
		setSelectedModelId,
	} = useSelectedModel();
	const [externalInput, setExternalInput] = useState<string>("");
	const [hasChatConversation, setHasChatConversation] = useState(false);
	const handleModelChange = (modelId: string) => {
		setSelectedModelId(modelId);
		setHasChatConversation(false);
	};
	// What the reader is looking at right now, so the assistant can answer
	// questions about these results.
	const searchContext = normalizeLibrarySearchContext(
		useFiltersContext().queryParams,
	);
	const { isAISearchEnabled } = useIsAISearchEnabled();
	// One search field, two things to do with it: typing filters the library
	// as you go, and Ask AI hands the same text to the assistant.
	const askAI = useAskInlineChat(searchContext);
	// The window is already built when it is closed, so a question typed on
	// the page can be asked the moment the reader opens it.
	const { chatWindow, isChatOpen, onChatOpenChange, openChatWindow } =
		useLibraryChatWindow();

	return (
		<div className="relative">
			<ChatModal
				// Changing the model starts a new conversation.
				key={selectedModelId ?? "no-model"}
				isOpen={isChatOpen}
				onOpenChange={onChatOpenChange}
				modelId={selectedModelId}
				onModelChange={handleModelChange}
				onConversationStateChange={setHasChatConversation}
				searchContext={searchContext}
				ref={chatWindow}
			/>
			<AnimatePresence mode="wait">
				{selectedTab === "search" ? (
					<ContentTabPanel key="search-content" fromLeft>
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
							askAI={isAISearchEnabled ? askAI : undefined}
						/>
					</ContentTabPanel>
				) : (
					<ContentTabPanel key="ai-content">
						<AITabContent
							askAI={askAI}
							onSwitchToSearch={() => setSelectedTab("search")}
							onChatOpen={openChatWindow}
							externalInput={externalInput}
							hasChatConversation={hasChatConversation}
							onModelChange={handleModelChange}
							setExternalInput={setExternalInput}
						/>
					</ContentTabPanel>
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
			/>
			<ItemsList props={props} />
		</>
	);
}

export default function EvidenceLibrary() {
	return (
		<PageContainer>
			<div className="flex xl:gap-10 gap-8 flex-col lg:flex-row">
				<MainContent />
			</div>
		</PageContainer>
	);
}
