"use client";

import { TruncatedText } from "@/components/nextui/TruncatedText";
import { AiOutlineCompass } from "react-icons/ai";
import { IoGrid } from "react-icons/io5";
import { BiHelpCircle } from "react-icons/bi";
import { HiOutlineViewList } from "react-icons/hi";
import { SkipLink } from "@/components/layout/SkipLink";

import { Button } from "@/components/nextui/Button";
import CollectionsList from "@/components/features/collections/CollectionsList";
import ExploreModal from "@/components/features/collections/ExploreModal";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import { Spinner, useDisclosure } from "@nextui-org/react";
import { Tooltip } from "@/components/nextui/Tooltip";
import { type ReactNode, use, useEffect, useRef } from "react";
import { Skeleton } from "@/components/nextui/Skeleton";
import HelpModal from "@/components/features/modals/HelpModal";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { getLangDir } from "rtl-detect";
import { twMerge } from "tailwind-merge";
import PageContainer from "../layout/PageContainer";
import { useItemsList } from "@/hooks/useItemsList";
import ItemsList from "../features/items/ItemsList";
import { ItemsContext } from "@/context/ItemsContext";
import {
	ScopeComponent,
	SortComponent,
} from "@/components/features/resources/LibrarySearchSelects";
import { SearchBar } from "@/components/features/SearchBar";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import ChatModal, { type ChatWindowHandle } from "../features/modals/ChatModal";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { useAskInlineChat } from "@/components/features/ai/useAskInlineChat";
import { useModEnterHint } from "@/hooks/useShortcutHints";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { useIsAISearchEnabled } from "@/hooks/useAISearchMode";
import { AskAIButton } from "@/components/features/ai/AskAIButton";
import { forgetWaitingQuestion, waitingQuestion } from "@/components/features/ai/handed-over-question";


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
			<ScopeComponent itemsContext={itemsContext} />
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

function SearchTitle({ title }: { title: string }) {
	return <TruncatedText text={title} focusable />;
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
	const { identity } = useLibraryConfig();
	const searchTitle = identity.tagline?.trim() || t("searchTitle");

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
				<div className="min-w-0 w-full lg:w-auto h-10 lg:h-12 flex flex-1 items-end gap-4">
					<SkipLink href="#collections">
						{t("goToFilters")}
					</SkipLink>
					<h1 className="min-w-0 flex-1 text-black dark:text-white/60 font-medium text-2xl lg:text-3xl">
						{header || (showHeader && <SearchTitle title={searchTitle} />)}
					</h1>
					<Button
						startContent={
							<AiOutlineCompass className="size-6 shrink-0" />
						}
						className="lg:hidden shrink-0 ml-auto rtl:ml-0 rtl:mr-auto h-full"
						onPress={onExploreOpen}
					>
						{t("explore")}
					</Button>
					<ExploreModal
						isOpen={isExploreOpen}
						onOpenChange={onExploreOpenChange}
					/>
				</div>
				<div className="flex gap-4 h-10 lg:h-12 shrink-0 justify-end">
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
	// A question handed over from another page (the home page's "Ask the
	// library"): ask it once the chat can take it, then forget it. If the chat
	// is still answering an earlier question, try again each second until it is
	// free; subscribing to the chat would redraw the whole listing per token.
	useEffect(() => {
		if (!waitingQuestion() || !isAISearchEnabled || itemsContext.userData) return;
		const ask = () => {
			const question = waitingQuestion();
			if (question && !askInline(question)) return false;
			forgetWaitingQuestion();
			return true;
		};
		if (ask()) return;
		const retry = setInterval(() => {
			if (ask()) clearInterval(retry);
		}, 1000);
		return () => clearInterval(retry);
	}, [askInline, isAISearchEnabled, itemsContext.userData]);

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

function collectionTransitions(
	engaged: boolean,
	reducedMotion: boolean,
): { collapse: Transition; content: Transition } {
	if (reducedMotion)
		return { collapse: { duration: 0 }, content: { duration: 0 } };
	if (engaged)
		return {
			collapse: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
			content: { duration: 0.35, ease: "easeOut" },
		};
	return {
		collapse: {
			delay: 0.13,
			duration: 0.42,
			ease: [0.16, 1, 0.3, 1],
		},
		content: {
			delay: 0.2,
			type: "spring",
			bounce: 0.15,
			duration: 0.55,
		},
	};
}

function CollectionsSidebar({
	engaged,
	children,
}: {
	engaged: boolean;
	children: ReactNode;
}) {
	const isRTL = getLangDir(useLocale()) === "rtl";
	const prefersReducedMotion = Boolean(useReducedMotion());
	const direction = isRTL ? -1 : 1;
	const exitOffset = prefersReducedMotion ? 0 : direction * 48;
	const extent = engaged ? 0 : "auto";
	const hidden = engaged || undefined;
	const { collapse: collapseTransition, content: contentTransition } =
		collectionTransitions(engaged, prefersReducedMotion);
	return (
		<motion.div
			initial={false}
			animate={{
				width: extent,
				height: extent,
			}}
			transition={collapseTransition}
			inert={hidden}
			aria-hidden={hidden}
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
						? { opacity: 0, x: exitOffset }
						: { opacity: 1, x: 0 }
				}
				transition={contentTransition}
				className="lg:w-[24rem] xl:w-[28.5rem]"
			>
				{children}
			</motion.div>
		</motion.div>
	);
}

function MainContent() {
	const props = useItemsList();
	const { engaged } = useInlineChatLayout();
	return (
		<>
			<CollectionsSidebar engaged={engaged}>
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
			</CollectionsSidebar>
			<ItemsList props={props} />
		</>
	);
}

export default function EvidenceLibrary() {
	const { engaged } = useInlineChatLayout();
	const { theme } = useLibraryConfig();
	return (
		<PageContainer
			className={twMerge(
				"transition-page-space duration-split ease-split motion-reduce:transition-none",

				engaged && "overflow-visible pt-4 lg:pt-5 xl:pt-0",
				// The small header leaves this gap under itself as it scales
				// down; the wide one really shrinks, so the page keeps it.
				engaged && theme.layout === "wide" && "xl:pt-split",
			)}
		>
			<div className="flex gap-[var(--library-gap)] [--library-gap:2rem] xl:[--library-gap:2.5rem] flex-col lg:flex-row lg:[container-type:inline-size]">
				<MainContent />
			</div>
		</PageContainer>
	);
}
