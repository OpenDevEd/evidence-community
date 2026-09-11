"use client";
import type { IconType } from "react-icons";
import { GiArchiveResearch } from "react-icons/gi";
import { AiOutlineCompass } from "react-icons/ai";
import { IoGrid } from "react-icons/io5";
import { BiHelpCircle } from "react-icons/bi";
import { HiOutlineViewList } from "react-icons/hi";
import { FaSort } from "react-icons/fa";
import { BsStars } from "react-icons/bs";
import { SkipLink } from "@/components/layout/SkipLink";

import { Button } from "@/components/nextui/Button";
import CollectionsList from "@/components/features/collections/CollectionsList";
import ExploreModal from "@/components/features/collections/ExploreModal";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import { Spinner, useDisclosure } from "@nextui-org/react";
import { Tooltip } from "@/components/nextui/Tooltip";
import {
	type ReactNode,
	use,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { SORT_OPTIONS } from "@/constants/items";
import HelpModal from "@/components/features/modals/HelpModal";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { getLangDir } from "rtl-detect";
import { twMerge } from "tailwind-merge";
import PageContainer from "../layout/PageContainer";
import { useItemsList } from "@/hooks/useItemsList";
import ItemsList, { ItemsContext } from "../features/items/ItemsList";
import { SearchBar } from "@/components/features/SearchBar";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import ChatModal, { type ChatWindowHandle } from "../features/modals/ChatModal";
import { motion, useReducedMotion } from "framer-motion";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { LibraryTagline } from "@/components/library/LibraryTagline";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getRuntimeSearchScopeOptions } from "@/config/library-config/search";
import { useAskInlineChat } from "@/components/features/ai/useAskInlineChat";
import { useModEnterHint } from "@/hooks/useShortcutHints";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { useIsAISearchEnabled } from "@/hooks/useAISearchMode";

function DropDownIcon({
	Icon,
	className,
	label,
}: {
	Icon: IconType;
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

export function SortComponent({
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

export function ScopeComponent({
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

/** Hands whatever is in the search field to the assistant. */
function AskAIButton({ hint, onAsk }: { hint: string; onAsk: () => void }) {
	const tAI = useTranslations("ai");
	const [revealed, setRevealed] = useState(false);
	// Firefox needs a painted frame before the entrance begins.
	useEffect(() => {
		let revealFrame = 0;
		const paintFrame = requestAnimationFrame(() => {
			revealFrame = requestAnimationFrame(() => setRevealed(true));
		});
		return () => {
			cancelAnimationFrame(paintFrame);
			cancelAnimationFrame(revealFrame);
		};
	}, []);
	if (!revealed) return null;

	return (
		// A plain button: press handling inside the search field's own
		// content breaks the one the rest of the site uses.
		<button
			type="button"
			onMouseDown={(event) => event.preventDefault()}
			onClick={onAsk}
			// Smaller on a phone, where the search field is shorter and
			// there is no keyboard to show a shortcut for.
			className="flex h-7 shrink-0 animate-rise-in items-center gap-1 self-center rounded-lg bg-accent px-2.5 text-xs font-medium text-white transition-transform hover:scale-102 active:scale-97 motion-reduce:animate-none lg:h-9 lg:gap-1.5 lg:rounded-[10px] lg:pl-3 lg:pr-1.5 lg:text-sm"
		>
			<BsStars className="size-3.5 shrink-0 lg:size-4" />
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
								<SkipLink href="#collections">
									{t("goToFilters")}
								</SkipLink>
								{showHeader && t("searchTitle")}
							</>
						)}
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

			<LibraryTagline show={showHeader} />

			<LibraryFilters
				askAI={askAI}
				extraFilters={extraFilters}
				itemsContext={itemsContext}
			/>

			{/* Results count and view controls */}
			<section className="flex justify-between h-10 lg:h-12 gap-8">
				<Skeleton
					isLoaded={
						!!itemsContext.itemsData || !!itemsContext.itemsError
					}
					className="flex items-center flex-1 rounded-2xl"
				>
					{!itemsContext.itemsError && (
						<h2
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
						</h2>
					)}
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
	const { selectedModelId, setSelectedModelId } = useSelectedModel();
	const { isAISearchEnabled } = useIsAISearchEnabled();
	const searchContext = itemsContext.userData
		? undefined
		: normalizeLibrarySearchContext(itemsContext.queryParams);
	const askInline = useAskInlineChat(searchContext);
	const { chatWindow, isChatOpen, onChatOpenChange, openChatWindow } =
		useLibraryChatWindow();

	return (
		<div className="relative">
			<ChatModal
				key={selectedModelId ?? "no-model"}
				ref={chatWindow}
				isOpen={isChatOpen}
				onOpenChange={onChatOpenChange}
				modelId={selectedModelId}
				onModelChange={setSelectedModelId}
				searchContext={searchContext}
			/>
			<SearchTabContent
				header={header}
				itemsContext={itemsContext}
				extraFilters={extraFilters}
				countLabel={countLabel}
				abstract={abstract}
				onAbstractChange={onAbstractChange}
				view={view}
				setView={setView}
				showHeader
				askAI={
					isAISearchEnabled
						? itemsContext.userData
							? openChatWindow
							: askInline
						: undefined
				}
			/>
		</div>
	);
}

function MainContent() {
	const isRTL = getLangDir(useLocale()) === "rtl";
	const props = useItemsList();
	const { engaged } = useInlineChatLayout();
	const prefersReducedMotion = useReducedMotion();

	return (
		<>
			<motion.div
				initial={false}
				animate={{
					width: engaged ? 0 : "auto",
					height: engaged ? 0 : "auto",
				}}
				transition={
					prefersReducedMotion
						? { duration: 0 }
						: engaged
							? { duration: 0.45, ease: [0.16, 1, 0.3, 1] }
							: {
									delay: 0.13,
									duration: 0.42,
									ease: [0.16, 1, 0.3, 1],
								}
				}
				inert={engaged || undefined}
				aria-hidden={engaged || undefined}
				style={{
					marginInlineEnd: engaged
						? "calc(-1 * var(--library-gap))"
						: "0rem",
				}}
				className={twMerge(
					"hidden shrink-0 lg:block transition-[margin-inline-end] duration-split ease-split motion-reduce:transition-none",
					!engaged && "delay-[130ms]",
					engaged && "pointer-events-none",
				)}
			>
				<motion.div
					initial={false}
					animate={
						engaged
							? {
									opacity: 0,
									x: prefersReducedMotion
										? 0
										: isRTL
											? -48
											: 48,
								}
							: { opacity: 1, x: 0 }
					}
					transition={
						prefersReducedMotion
							? { duration: 0 }
							: engaged
								? { duration: 0.35, ease: "easeOut" }
								: {
										delay: 0.2,
										type: "spring",
										bounce: 0.15,
										duration: 0.55,
									}
					}
					className="lg:w-[24rem] xl:w-[28.5rem]"
				>
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
				</motion.div>
			</motion.div>

			<ItemsList props={props} />
		</>
	);
}

export default function EvidenceLibrary() {
	const { engaged } = useInlineChatLayout();
	return (
		<PageContainer
			className={twMerge(
				"transition-page-space duration-split ease-split motion-reduce:transition-none",

				engaged && "overflow-visible pt-4 lg:pt-5 xl:pt-0",
			)}
		>
			<div className="flex gap-[var(--library-gap)] [--library-gap:2rem] xl:[--library-gap:2.5rem] flex-col lg:flex-row lg:[container-type:inline-size]">
				<MainContent />
			</div>
		</PageContainer>
	);
}
