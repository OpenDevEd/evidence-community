"use client";
import { ReactNode, use, useContext, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import {
	AnimatePresence,
	motion,
	useAnimate,
	useReducedMotion,
} from "framer-motion";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/nextui/Button";
import { FaCompass, FaTrash } from "react-icons/fa";
import {
	ContentInteractions,
	ScopeComponent,
	SortComponent,
} from "@/components/pages/EvidenceLibrary";
import ExploreModal from "@/components/features/collections/ExploreModal";
import useBreakpoint from "@/hooks/useBreakpoint";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Pagination } from "@/components/nextui/Pagination";
import { HiOutlineDownload, HiOutlinePrinter } from "react-icons/hi";
import { ITEMS_PER_PAGE } from "@/constants/items";
import Resource from "../items/Resource";
import { HiOutlineCodeBracketSquare } from "react-icons/hi2";
import {
	CacheContext,
	CacheContextType,
	useFeatureFlagEnabled,
} from "@/context/Providers";
import { DownloadModal } from "../items/ItemControls";
import { CardBody, useDisclosure } from "@nextui-org/react";
import { downloadItems } from "@/lib/actions";
import { routing, usePathname, useRouter } from "@/i18n/routing";
import { ItemsContext } from "../items/ItemsList";
import { useFiltersContext } from "@/context/FiltersProvider";
import { countryFacetOptions } from "@/constants/misc";
import { hasYearConstraint } from "@/lib/searchParams";
import { style as siteStyle } from "@/../tailwind.config";
import Image from "next/image";
import { getCountryInfo } from "@/lib/utils";
import { Item } from "@/app/api/item/types";
import { Card } from "@/components/nextui/Card";
import { Divider } from "@/components/nextui/Divider";
import { Switch } from "@/components/nextui/Switch";
import { Tooltip } from "@/components/nextui/Tooltip";
import { AiOutlineCompass } from "react-icons/ai";
import InlineLibraryChat from "../ai/InlineLibraryChat";
import { BucketList } from "../ai/ContextBucket";
import { SearchBar } from "@/components/features/SearchBar";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { trackLibraryResultsLoaded } from "@/lib/analytics";

function Chip({
	group,
	title,
	divKey,
	callback,
	classNames = {},
	startContent,
}: {
	group: string | undefined;
	title: string | undefined;
	divKey: string;
	callback: () => void;
	classNames?: {
		group?: string;
		title?: string;
		button?: string;
	};
	startContent?: ReactNode;
}) {
	const canClick = useRef(true);
	const [debounceCanClick] = useDebounce(() => {
		canClick.current = true;
	}, 1000);

	return (
		<Button
			size="xs"
			variant="solid"
			className={twMerge(
				"shrink-0 p-1 h-auto ltr:pr-2 rtl:pl-2",
				classNames.button
			)}
			onPress={() => {
				if (canClick.current) {
					callback();
					canClick.current = false;
				}
				debounceCanClick();
			}}
		>
			{group && (
				<span
					className={twMerge(
						"text-white dark:text-white/40 font-medium text-xs leading-3 dark:bg-black/50 bg-black/50 p-1 px-2 rounded-md",
						classNames.group
					)}
				>
					{group}
				</span>
			)}
			{startContent}
			<span
				className={twMerge(
					"block max-w-[16rem] truncate",
					classNames.title
				)}
			>
				{title}
			</span>
		</Button>
	);
}

// Concise label for the publication-year (`range`) chip — e.g. "2015",
// "2010–2020", "2010+", "–2020".
function yearChipTitle(range: string): string {
	const [rawStart, rawEnd] = range.includes("-")
		? range.split("-")
		: [range, range];
	const start = (rawStart || "").trim();
	const end = (rawEnd || "").trim();
	if (start && end) return start === end ? start : `${start}–${end}`;
	if (start) return `${start}+`;
	if (end) return `–${end}`;
	return range;
}

function countActiveFilters(queryParams: Record<string, any>) {
	return (
		(queryParams.collections?.length || 0) +
		(queryParams.institution?.length || 0) +
		(queryParams.author ? 1 : 0) +
		(hasYearConstraint(queryParams.range) ? 1 : 0) +
		countryFacetOptions.reduce(
			(acc, facet) => acc + (queryParams[facet.queryParam]?.length || 0),
			0
		)
	);
}

function useFilterChips(
	queryParams: Record<string, any>,
	handleClearFilters?: () => void
) {
	const filtersCount = countActiveFilters(queryParams);
	const clearButton = () => {
		handleClearFilters?.();
	};

	return {
		filtersCount,
		clearButton,
	};
}

export function FilterChips() {
	// Reads the shared, app-level filter state so the navbar chips and the
	// library chips are the exact same resident instance (no remount flash).
	const itemsContext = useFiltersContext();
	const t = useTranslations("ui");
	const { filtersCount, clearButton } = useFilterChips(
		itemsContext.queryParams,
		itemsContext.handleClearFilters
	);

	return (
		<div
			className={twMerge(
				"flex max-h-0 overflow-y-hidden transition-[max-height,opacity,margin] duration-200 opacity-0 mb-0",
				filtersCount > 0 && "max-h-[32rem] mb-4 opacity-100"
			)}
		>
			{/* On mobile the chips scroll horizontally inside their own track so a
			    long chip can't push the whole row (and the clear button) off-screen;
			    on sm+ they wrap as before. */}
			<div className="relative flex min-w-0 flex-1 gap-2 overflow-x-auto [&>div]:shrink-0 [scrollbar-width:none] sm:flex-wrap sm:overflow-x-visible [&::-webkit-scrollbar]:hidden">
				<AnimatePresence initial={false} mode="popLayout">
					{hasYearConstraint(itemsContext.queryParams?.range) && (
						<motion.div
							key={"year-" + itemsContext.queryParams.range}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{ duration: 0.2 }}
						>
							<Chip
								key={"year-" + itemsContext.queryParams.range}
								divKey={"year-" + itemsContext.queryParams.range}
								group={t("year")}
								title={yearChipTitle(
									itemsContext.queryParams.range
								)}
								callback={() =>
									itemsContext.handleRangeChange?.(null, null)
								}
								classNames={{
									button: "bg-success/80 dark:bg-success/80",
									title: "text-white dark:text-white",
								}}
							/>
						</motion.div>
					)}
					{countryFacetOptions.map((facet) => {
						const values = itemsContext.queryParams[
							facet.queryParam
						] as string[];
						if (!values) return null;

						return values.map((value) => {
							const {
								countryName,
								label,
								numberOfParts,
								countryCode,
							} = getCountryInfo(value);
							return (
								<motion.div
									key={`${facet.queryParam}-${value}`}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -10 }}
									transition={{ duration: 0.2 }}
								>
									<Chip
										key={`${facet.queryParam}-${value}`}
										divKey={`${facet.queryParam}-${value}`}
										group={t(facet.label)}
										title={label}
										startContent={
											countryName && (
												<Image
													src={`https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`}
													alt={value}
													width={16}
													height={12}
													className="ml-0.5"
												/>
											)
										}
										callback={() =>
											(itemsContext as any)[facet.action](
												value
											)
										}
										classNames={{
											button: "bg-primary dark:bg-primary/40",
											title: "text-black dark:text-white",
										}}
									/>
								</motion.div>
							);
						});
					})}
					{itemsContext.queryParams.institution.length > 0 &&
						itemsContext.queryParams.institution.map(
							(institution) => (
								<motion.div
									key={"institution-" + institution}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -10 }}
									transition={{ duration: 0.2 }}
								>
									<Chip
										key={"institution-" + institution}
										group={"Institution"}
										title={institution}
										divKey={"institution-" + institution}
										callback={() =>
											itemsContext.handleInstitutionSelect?.(
												institution
											)
										}
										classNames={{
											button: "bg-accent/80 dark:bg-accent/80",
											title: "text-white dark:text-white",
										}}
									/>
								</motion.div>
							)
						)}
					{itemsContext.collectionsData &&
						itemsContext.selectedCollections?.map(
							(collection: string) => {
								const collectionData =
									itemsContext.collectionsData?.collections.find(
										(c) => c.key === collection
									);
								return (
									<motion.div
										key={"collection-" + collection}
										initial={{ opacity: 0, y: 10 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -10 }}
										transition={{ duration: 0.2 }}
									>
										<Chip
											key={"collection-" + collection}
											group={collectionData?.title}
											// Fall back to the raw key when the
											// collection isn't in the loaded tree,
											// so the chip still reads sensibly.
											title={
												collectionData?.name ||
												collection
											}
											divKey={collection}
											callback={() =>
												itemsContext.handleCheckboxChange?.(
													collection
												)
											}
										/>
									</motion.div>
								);
							}
						)}
									{itemsContext.queryParams?.author && (
						<motion.div
							key={"author-" + itemsContext.queryParams.author}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{ duration: 0.2 }}
						>
							<Chip
								key={
									"author-" + itemsContext.queryParams.author
								}
								divKey={
									"author-" + itemsContext.queryParams.author
								}
								group={"Author"}
								title={itemsContext.queryParams.author}
								callback={() =>
									itemsContext.handleAuthorSelect?.(
										itemsContext.queryParams.author
									)
								}
								classNames={{
									button: "bg-tertiary dark:bg-tertiary/40",
									title: "text-white dark:text-white",
								}}
							/>
						</motion.div>
					)}
</AnimatePresence>
			</div>
			<AnimatePresence initial={false}>
				{filtersCount > 0 && (
					<motion.div
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2 }}
						className="w-7 shrink-0 flex justify-end"
					>
						<Button
							aria-hidden={
								itemsContext.selectedCollections.length == 0
							}
							aria-label={t("clearFiltersAriaLabel")}
							onPress={clearButton}
							isIconOnly
							size="sm"
							variant="solid"
							color="accent"
							className="h-7 w-7 min-w-7"
						>
							<FaTrash
								aria-hidden="true"
								className="text-white size-3"
							/>
						</Button>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function ResourcesList({
	abstract,
	view,
	className,
	openLinksInNewTab,
}: {
	abstract: boolean;
	view: string;
	className?: string;
	/** Open result pages in a new tab (split chat mode keeps the chat put). */
	openLinksInNewTab?: boolean;
}) {
	const itemsContext = use(ItemsContext);
	const t = useTranslations("ui");
	const actuallyNoData =
		(!itemsContext.isItemsLoading &&
			itemsContext.itemsData &&
			itemsContext.itemsData.items.length === 0) ||
		itemsContext.itemsError;

	return (
		<>
			<ul
				className={twMerge(
					"gap-6 -mt-4",
					view === "list" || actuallyNoData
						? "flex flex-col"
						: "grid grid-cols-2",
					className,
				)}
			>
				{actuallyNoData ? (
					<div className="text-center text-black/40 dark:text-white/40 text-sm mb-4 py-12">
						{t("noResourcesFound")}
					</div>
				) : (
					Array.from({ length: ITEMS_PER_PAGE }).map(
						(_, index) =>
							(!itemsContext.itemsData ||
								(itemsContext.itemsData &&
									itemsContext.itemsData.items[index])) && (
								<Resource
									key={index}
									itemData={
										itemsContext.itemsData?.items[index]
									}
									abstract={abstract}
									isLoading={itemsContext.isItemsLoading}
									revalidateResults={
										itemsContext.revalidateResults
									}
									collectionId={
										itemsContext.queryParams.collectionId
									}
									openLinksInNewTab={openLinksInNewTab}
								/>
							)
					)
				)}
			</ul>
		</>
	);
}

function ContentActions({ params }: { params?: Record<string, any> }) {
	const itemsContext = use(ItemsContext);
	const t = useTranslations("ui");
	const format = useFormatter();
	const totalItems = itemsContext.itemsData?.totalItems || 0;
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const router = useRouter();
	const pathName = usePathname();
	const isDownloadEnabled = useFeatureFlagEnabled("download-button");
	const isAtomFeedEnabled = useFeatureFlagEnabled("atom-feed");

	return (
		<div className="lg:flex lg:justify-end grid gap-4 flex-wrap empty:hidden">
			<DownloadModal
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				onClose={onClose}
				action={async (format: "ris" | "bibtex") => {
					return await downloadItems(
						itemsContext.queryParams,
						params || {},
						format
					);
				}}
				fileName={
					format.number(totalItems) +
					" " +
					format.dateTime(new Date(), {
						day: "2-digit",
						month: "2-digit",
						year: "numeric",
					})
				}
			/>
			{isDownloadEnabled && (
				<Button
					endContent={<HiOutlineDownload className="size-6" />}
					onPress={onOpen}
				>
					{t("downloadRecords", { count: format.number(totalItems) })}
				</Button>
			)}
			{/* <Button
				isDisabled={!isPrintingEnabled}
				endContent={<HiOutlinePrinter className="size-6" />}
			>
				{t("printCitations", { count: format.number(totalItems) })}
			</Button> */}
			{isAtomFeedEnabled && (
				<Button
					onPress={() => {
						router.push(
							{
								pathname: pathName + "/atom.xml",
								query: itemsContext.searchParams,
							},
							{
								locale: routing.defaultLocale,
							}
						);
					}}
					endContent={
						<HiOutlineCodeBracketSquare className="size-6" />
					}
				>
					{JSON.stringify(itemsContext.searchParams) == "{}"
						? t("mainFeed")
						: t("customFeed")}
				</Button>
			)}
		</div>
	);
}

function PaginationControls({ className }: { className?: string }) {
	const itemsContext = use(ItemsContext);
	const totalPages = itemsContext.itemsData?.totalPages || 0;
	const actuallyNoData =
		(!itemsContext.isItemsLoading &&
			itemsContext.itemsData &&
			itemsContext.itemsData.items.length === 0) ||
		itemsContext.itemsError;
	const isDesktop = useBreakpoint("xl");

	return (
		!actuallyNoData && (
			<div
				className={twMerge(
					"w-full flex justify-center py-2 lg:py-6 z-10",
					className,
				)}
			>
				<Skeleton
					isLoaded={totalPages > 0}
					className="w-full h-14 rounded-2xl flex items-center justify-center"
				>
					{totalPages > 0 && (
						<Pagination
							showControls
							page={itemsContext.queryParams.page}
							onChange={itemsContext.handlePageChange}
							siblings={
								itemsContext.config.paginationSiblings ||
								(isDesktop ? 3 : 0)
							}
							total={totalPages}
						/>
					)}
				</Skeleton>
			</div>
		)
	);
}

/**
 * Removes trailing empty elements (no meaningful text content)
 * from the given HTML string, starting from the bottom of the DOM tree.
 * Stops when it reaches an element containing text content.
 *
 * Works exclusively in the browser (Next.js client-side components).
 */
export function removeTrailingEmptyElements(html: string): string {
	if (!html.trim()) return html;

	const document = new DOMParser().parseFromString(html, "text/html");
	const root = document.body;

	// Get only the direct (immediate) text content of an element (no descendants)
	const getDirectText = (el: Element): string =>
		Array.from(el.childNodes)
			.filter((n) => n.nodeType === Node.TEXT_NODE)
			.map((n) => n.textContent ?? "")
			.join("");

	/**
	 * True if the element's direct text starts with:
	 * (optional whitespace) + (zero or more underscores) + %% + anything
	 */
	const startsWithDirective = (el: Element): boolean =>
		/^\s*_*\%\%/.test(getDirectText(el));

	// Checks if an element has neither non-whitespace text nor non-empty child elements
	const isEmpty = (el: Element): boolean => {
		const hasNonWhitespaceDirectText = Array.from(el.childNodes).some(
			(n) =>
				n.nodeType === Node.TEXT_NODE &&
				(n.textContent?.trim() ?? "") !== ""
		);
		const hasElementChildren = el.children.length > 0;
		return !hasNonWhitespaceDirectText && !hasElementChildren;
	};

	/**
	 * Bottom-up recursive cleaner:
	 * - Cleans children first
	 * - Removes node if it’s empty or starts with `_*%%`
	 */
	const cleanBottomUp = (node: Element): boolean => {
		const children = Array.from(node.children);
		for (const child of children) {
			const removable = cleanBottomUp(child);
			if (removable && node.contains(child)) {
				node.removeChild(child);
			}
		}
		return isEmpty(node) || startsWithDirective(node);
	};

	/**
	 * Remove leading/trailing empty or directive elements among siblings
	 */
	const cleanEdges = (parent: Element) => {
		const children = Array.from(parent.children);
		// remove leading empties
		for (const child of children) {
			if (isEmpty(child) || startsWithDirective(child))
				parent.removeChild(child);
			else break;
		}
		// remove trailing empties
		const revChildren = Array.from(parent.children).reverse();
		for (const child of revChildren) {
			if (isEmpty(child) || startsWithDirective(child))
				parent.removeChild(child);
			else break;
		}
		// recurse into remaining children
		Array.from(parent.children).forEach(cleanEdges);
	};

	// First pass – remove inner empties
	cleanBottomUp(root);
	// Second pass – remove leading/trailing empties at all levels
	cleanEdges(root);

	return root.innerHTML.trim();
}

export function NoteView() {
	const itemsContext = useFiltersContext();
	const selectedCollection = itemsContext.selectedCollections[0];
	const collectionData = itemsContext.collectionsData?.collections.find(
		(c) => c.key === selectedCollection
	);
	const isCollectionNoteEnabled = useFeatureFlagEnabled("collection-note");

	return (
		isCollectionNoteEnabled && (
			<AnimatePresence>
				{itemsContext.noteData?.note && (
					<motion.div
						className="w-full"
						initial={{ opacity: 0, y: 20, height: 0, scale: 0.75 }}
						animate={{ opacity: 1, y: 0, height: "auto", scale: 1 }}
						exit={{ opacity: 0, y: -20, height: 0, scale: 0.7 }}
						transition={{
							duration: 0.2,
							ease: "easeOut",
						}}
					>
						<Card color="card">
							<CardBody>
								<div className="flex flex-col gap-4">
									<h3 className="text-xl text-black/80 dark:text-white/80 font-medium flex flex-col">
										<div className="flex gap-2 items-center">
											<AiOutlineCompass className="size-4 shrink-0" />
											<span className="text-base text-black/80 dark:text-white/80">
												{collectionData?.title}
											</span>
										</div>
										<span className="text-black/40 dark:text-white/40">
											{collectionData?.name}
										</span>
									</h3>
									<Divider />
									<p
										className="prose max-w-full dark:prose-invert [&_*:last-child]:mb-0 [&_*:first-child]:mt-0 leading-tight"
										dangerouslySetInnerHTML={{
											__html: removeTrailingEmptyElements(
												itemsContext.noteData?.note
													.note ?? ""
											),
										}}
									/>
								</div>
							</CardBody>
						</Card>
					</motion.div>
				)}
			</AnimatePresence>
		)
	);
}

export function ResourcesView({
	extraFilters,
	params,
	countLabel,
	header,
}: {
	extraFilters: ReactNode;
	params?: Record<string, any>;
	countLabel?: ReactNode;
	header?: ReactNode;
}) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const [abstract, setAbstract] = useState(true);
	const [view, setView] = useState("list");
	// Split-mode panel state lives here so the results list below can be a
	// single, stable instance across both modes (remounting twenty cards on
	// every toggle was a ~100 ms hitch at the start of each animation).
	const [engagedView, setEngagedView] =
		useState<EngagedLibraryView>("results");
	const [engagedAbstract, setEngagedAbstract] = useState(false);
	const { status } = useContext(CacheContext) as CacheContextType;
	const itemsContext = use(ItemsContext);
	// The split state and conversation persist across navigation (open a
	// result, come back, the chat is still there); the provider scopes
	// `engaged` to the library route.
	const { engaged } = useInlineChatLayout();
	// Keep the chat mounted briefly after disengaging so its fade-out plays
	// (render-phase state adjustment per react.dev "You Might Not Need an
	// Effect"; the timeout clears the linger once the fade is done).
	const [chatLinger, setChatLinger] = useState(false);
	const [prevEngaged, setPrevEngaged] = useState(engaged);
	if (engaged !== prevEngaged) {
		setPrevEngaged(engaged);
		if (!engaged) setChatLinger(true);
	}
	useEffect(() => {
		if (!chatLinger || engaged) return;
		const timeout = setTimeout(() => setChatLinger(false), 400);
		return () => clearTimeout(timeout);
	}, [chatLinger, engaged]);
	const showChat = engaged || chatLinger;
	// True once the split has toggled since mount; gates the panel-swap
	// entrance animation so it never plays on the initial page render.
	const [hasSwapped, setHasSwapped] = useState(false);
	const [swapBaseline] = useState(engaged);
	if (!hasSwapped && engaged !== swapBaseline) setHasSwapped(true);
	// The results column is its own plane: on close it comes forward (slides
	// in from the right, scales up from its right edge) under a transient
	// drop shadow; on open it recedes the same way in reverse. Transform and
	// opacity only, driven imperatively so the column never remounts.
	const [planeScope, animatePlane] = useAnimate();
	const prefersReducedMotion = useReducedMotion();
	// Run only on a real change of `engaged`, never on mount. (A "skip the
	// first run" flag is not enough: StrictMode double-invokes mount effects
	// in development, so the second run would play the motion on page load.)
	const planePrevEngagedRef = useRef(engaged);
	useEffect(() => {
		if (planePrevEngagedRef.current === engaged) return;
		planePrevEngagedRef.current = engaged;
		if (prefersReducedMotion) return;
		const plane = planeScope.current as HTMLElement | null;
		const shadow = plane?.querySelector<HTMLElement>("[data-plane-shadow]");
		if (!plane || !shadow) return;
		const fromX = engaged ? -PLANE_SHIFT : PLANE_SHIFT;
		const fromScale = engaged ? PLANE_RECEDE_SCALE : PLANE_LIFT_SCALE;
		const controls = [
			animatePlane(
				plane,
				{ x: [fromX, 0], scale: [fromScale, 1] },
				{ ...PLANE_SPRING, delay: engaged ? 0 : PLANE_CLOSE_DELAY },
			),
			animatePlane(
				shadow,
				{ opacity: [0, 1, 0] },
				{
					duration: 0.7,
					times: [0, 0.3, 1],
					ease: "easeOut",
					delay: engaged ? 0 : PLANE_CLOSE_DELAY,
				},
			),
		];
		return () => controls.forEach((c) => c.stop());
	}, [engaged, animatePlane, planeScope, prefersReducedMotion]);
	const { selectedModel } = useSelectedModel();
	const searchContext = itemsContext.userData
		? undefined
		: normalizeLibrarySearchContext(itemsContext.queryParams);
	const resultsAnalyticsSignature = useRef<string | null>(null);
	useEffect(() => {
		const data = itemsContext.itemsData;
		if (!data || !searchContext) return;

		// Keep the full context only in this local de-duplication key. Analytics
		// receives booleans and counts, never the query or filter values.
		const signature = JSON.stringify({
			context: searchContext,
			page: data.currentPage,
			pageResultCount: data.items.length,
			totalResultCount: data.totalItems,
		});
		if (resultsAnalyticsSignature.current === signature) return;
		resultsAnalyticsSignature.current = signature;

		trackLibraryResultsLoaded({
			hasSearch: searchContext.search.trim().length > 0,
			filterCount: countActiveFilters(searchContext),
			page: data.currentPage,
			pageResultCount: data.items.length,
			totalResultCount: data.totalItems,
			scope: searchContext.scope,
			sort: searchContext.sort,
		});
	}, [itemsContext.itemsData, searchContext]);

	return (
		<section
			id="main-content"
			className={twMerge(
				"w-full flex flex-col gap-4",
				// overflow-hidden would break the chat panel's sticky
				// positioning, so it only applies outside the split layout.
				// The negative-margin/padding pair gives focus rings room so
				// the clip edge doesn't shave them off.
				!engaged && "-mx-1 overflow-hidden px-1",
			)}
		>
			{/* Collection note: page-wide normally; in split mode it lives at
			    the top of the results column instead (below), so it never
			    pushes the chat down. */}
			{!engaged && <NoteView />}
			{/*
			 * The split view is a permanent grid whose columns are animated
			 * via a CSS grid-template-columns transition (fr tracks
			 * interpolate). This lets the chat column squeeze open/closed
			 * while the results expand in one continuous motion — flipping
			 * grid classes on and off instead snaps the layout mid-exit.
			 */}
			<div
				className={twMerge(
					// Expo-out ease: the columns move fast then settle long,
					// so the reflow reads as a snap rather than a slow slide.
					"w-full lg:grid lg:grid-cols-[minmax(0,0fr)_minmax(0,1fr)] lg:items-start lg:gap-x-0 lg:transition-[grid-template-columns,column-gap] lg:duration-[450ms] lg:ease-[cubic-bezier(0.16,1,0.3,1)]",
					// Close: let the chat sheet start sinking before the
					// track reflows, so the two read as separate planes.
					!engaged && "lg:delay-[80ms]",
					engaged &&
						"grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] lg:gap-x-6 xl:gap-x-8",
				)}
			>
				{/*
				 * Manual presence: AnimatePresence permanently swallows this
				 * child after its first exit (framer + StrictMode re-entry
				 * bug), so the cell enters via a CSS animation and lingers
				 * through a state-driven fade-out before unmounting.
				 */}
				{showChat && (
					<div
						inert={!engaged || undefined}
						className={twMerge(
							// Matches the panel's natural resting offset under
							// the sticky navbar, so it never shifts on scroll.
							"min-w-0 origin-bottom animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 lg:sticky lg:top-[4.75rem] lg:col-start-1 lg:row-start-1",
							// Header stack at xl: wide = 75%-scaled header (4.875rem)
							// + 1.625rem gap = 6.5rem; small floats the header a
							// further 1.625rem down = 8.125rem.
							siteStyle === "small"
								? "xl:top-[8.125rem]"
								: "xl:top-[6.5rem]",
							// Reveal, not squeeze: the cell clips, and the chat
							// inside keeps its final width (below) so it slides
							// in/out under the clip instead of re-wrapping its
							// content on every frame of the track animation.
							"lg:overflow-hidden",
							// Opacity + transform only: a blur() here would
							// re-rasterise a viewport-sized surface every frame.
							"transition-[opacity,transform] ease-in",
							// Close: the card dismisses like a sheet — sinks and
							// shrinks away — while the results column snaps
							// open beside it.
							engaged
								? "opacity-100"
								: "pointer-events-none translate-y-6 scale-[0.97] opacity-0",
						)}
					>
						{/*
						 * Pinned to the column's final width: (row width −
						 * column gap) × 5/9, from the page row's inline-size
						 * container — which does not change during the
						 * animation, unlike the grid itself. Right-anchored so
						 * the chat slides in from the left edge as the cell
						 * opens, and back out as it closes.
						 */}
						<div className="lg:ml-auto lg:w-[calc((100cqw-1.5rem)*5/9)] xl:w-[calc((100cqw-2rem)*5/9)]">
							<InlineLibraryChat
								key={selectedModel}
								modelId={selectedModel}
								searchContext={searchContext}
							/>
						</div>
					</div>
				)}
				<div
					ref={planeScope}
					style={{ transformOrigin: "right center" }}
					// @container: the engaged controls adapt to this column's
					// width, not the viewport.
					className="@container relative flex w-full min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1"
				>
					{/* Transient elevation while the plane moves; opacity-only. */}
					<div
						data-plane-shadow
						aria-hidden
						// Capped to one viewport: the column can be thousands
						// of pixels tall, and a blurred shadow rasterised on a
						// layer that size is what made the first frame of the
						// motion stutter. Only the visible part ever matters.
						className="pointer-events-none absolute inset-x-[-0.75rem] top-[-0.75rem] -z-10 h-[calc(100dvh+1.5rem)] max-h-[calc(100%+1.5rem)] rounded-3xl opacity-0 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[0_40px_90px_-30px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.06)]"
					/>
					{/*
					 * No AnimatePresence here: the page can mount with the
					 * split already open (back navigation) and flip state
					 * before first paint, which leaves AnimatePresence
					 * holding an exiting child forever — both panels then
					 * render stacked. Only the active panel exists; it
					 * enters with a CSS animation (runs unconditionally on
					 * insertion), skipped on the initial page render so
					 * first paint stays still. The plane motion above
					 * provides the depth on close.
					 */}
					{engaged && <NoteView />}
					{engaged ? (
						<div
							key="engaged-panel"
							className={twMerge(
								"flex w-full min-w-0 flex-col gap-4",
								hasSwapped &&
									"animate-in fade-in slide-in-from-right-4 duration-200 ease-out",
							)}
						>
							<EngagedLibraryPanel
								extraFilters={extraFilters}
								view={engagedView}
								setView={setEngagedView}
								abstract={engagedAbstract}
								setAbstract={setEngagedAbstract}
							/>
						</div>
					) : (
						<div
							key="library-full"
							className={twMerge(
								"flex w-full min-w-0 flex-col gap-4",
								hasSwapped &&
									"animate-in fade-in slide-in-from-left-4 duration-200 ease-out",
							)}
						>
							<ContentInteractions
								header={header}
								abstract={abstract}
								onAbstractChange={setAbstract}
								view={view}
								setView={setView}
								countLabel={countLabel}
								extraFilters={extraFilters}
							/>
							<FilterChips />
						</div>
					)}
					{/*
					 * One list for both modes — same tree position, so React
					 * keeps the cards mounted through the swap. Hidden (not
					 * unmounted) behind the Sources tab. The -mt-4 absorbs the
					 * collapsed FilterChips slot inside the controls above.
					 */}
					<ResourcesList
						abstract={engaged ? engagedAbstract : abstract}
						view={engaged ? "list" : view}
						openLinksInNewTab={engaged}
						className={twMerge(
							engaged && "gap-4",
							engaged && engagedView === "sources" && "hidden",
						)}
					/>
					<PaginationControls
						className={twMerge(
							engaged && "py-0 lg:py-0",
							engaged && engagedView === "sources" && "hidden",
						)}
					/>
					{!engaged && (
						<>
							<ContentActions params={params} />
							<div className="text-center lg:text-end text-black/60 dark:text-white/60 text-sm">
									{t("lastUpdate", {
										date: format.dateTime(
											new Date(
												status.databaseUpdatedAt!,
											),
											{
												day: "2-digit",
												month: "2-digit",
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit",
											},
										),
									})}
							</div>
						</>
					)}
				</div>
			</div>
		</section>
	);
}

// Results-column plane motion (see the useAnimate effect in ResourcesView).
const PLANE_SHIFT = 28;
const PLANE_LIFT_SCALE = 0.97;
const PLANE_RECEDE_SCALE = 0.985;
const PLANE_CLOSE_DELAY = 0.08;
const PLANE_SPRING = {
	type: "spring",
	stiffness: 260,
	damping: 30,
	mass: 1.05,
} as const;
type EngagedLibraryView = "results" | "sources";

/**
 * The right-hand side of the split chat layout: one compact panel with the
 * search field, active filter chips, and a segmented Results/Sources switch —
 * the publications the model touches live in the Sources view instead of
 * being stacked on top of the results.
 */
function EngagedLibraryPanel({
	extraFilters,
	view,
	setView,
	abstract,
	setAbstract,
}: {
	extraFilters: ReactNode;
	view: EngagedLibraryView;
	setView: (view: EngagedLibraryView) => void;
	abstract: boolean;
	setAbstract: (abstract: boolean) => void;
}) {
	const t = useTranslations("ui");
	const tAI = useTranslations("ai");
	const formatter = useFormatter();
	const itemsContext = use(ItemsContext);
	const { bucketEntries } = useInlineChatLayout();
	// Collections / year / institutions / countries live in the sidebar
	// that split mode collapses, so they open as a side sheet instead.
	const {
		isOpen: isExploreOpen,
		onOpen: onExploreOpen,
		onOpenChange: onExploreOpenChange,
	} = useDisclosure();
	const totalItems = itemsContext.itemsData?.totalItems ?? 0;

	const segments: Array<{
		key: EngagedLibraryView;
		label: string;
		count: number;
	}> = [
		{ key: "results", label: t("resultsLabel"), count: totalItems },
		{
			key: "sources",
			label: tAI("sourcesTitle"),
			count: bucketEntries.length,
		},
	];

	return (
		<div className="flex w-full min-w-0 flex-col gap-4">
			{/* Tabs + (Results only) Abstract/Explore: one row on lg+, two
			    stacked rows on mobile where the column is too narrow. */}
			<div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<div
				role="tablist"
				className="inline-flex w-fit shrink-0 items-center gap-1 rounded-2xl bg-black/[0.04] p-1 dark:bg-white/[0.06]"
			>
				{segments.map((segment) => (
					<button
						key={segment.key}
						type="button"
						role="tab"
						aria-selected={view === segment.key}
						onClick={() => setView(segment.key)}
						className={twMerge(
							"relative h-9 rounded-xl px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus",
							view === segment.key
								? "text-black dark:text-white"
								: "text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80",
						)}
					>
						{view === segment.key && (
							<motion.span
								layoutId="engaged-library-segment"
								transition={{
									type: "spring",
									bounce: 0.2,
									duration: 0.5,
								}}
								className="absolute inset-0 rounded-xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-white/10 dark:shadow-none"
							/>
						)}
						<span className="relative flex items-center gap-1.5">
							{segment.label}
							<motion.span
								key={segment.count}
								initial={{
									scale: segment.key === "sources" ? 1.35 : 1,
								}}
								animate={{ scale: 1 }}
								transition={{
									type: "spring",
									bounce: 0.5,
									duration: 0.45,
								}}
								className="text-xs tabular-nums text-black/40 dark:text-white/40"
							>
								{formatter.number(segment.count)}
							</motion.span>
						</span>
					</button>
				))}
			</div>
			{view === "results" && (
				<div className="flex min-w-0 shrink-0 items-stretch gap-3 animate-in fade-in duration-200 max-lg:[&>*]:flex-1">
					<Card color="card" className="flex h-11 min-w-0 items-center justify-center px-3 border-small border-black/10 dark:border-white/10 dark:bg-secondary shadow-none">
						<Switch
							size="sm"
							isSelected={abstract}
							onValueChange={setAbstract}
							classNames={{ base: "flex-row-reverse" }}
						>
							{t("abstract")}
						</Switch>
					</Card>
					{/* Icon-only while the column is too narrow for the tabs,
					    Abstract and a labelled Explore on one row (lg+ below
					    ~34rem); the label returns with room, and always shows
					    on mobile where this group has its own row. */}
					<Tooltip content={t("explore")}>
						<Button
							startContent={
								<AiOutlineCompass className="size-5 shrink-0" />
							}
							aria-label={t("explore")}
							className="h-11 min-w-11 shrink-0 lg:px-0 lg:@[34rem]:px-4"
							onPress={onExploreOpen}
						>
							<span className="lg:hidden lg:@[34rem]:inline">
								{t("explore")}
							</span>
						</Button>
					</Tooltip>
					<ExploreModal
						variant="sheet"
						isOpen={isExploreOpen}
						onOpenChange={onExploreOpenChange}
					/>
				</div>
			)}
			</div>
			{/*
			 * Plain conditional, no AnimatePresence (see the page-level swap
			 * above for why). The search/sort controls belong to Results
			 * only; Sources is just the bucket.
			 */}
			{view === "results" ? (
				<div
					key="results-view"
					className="flex w-full min-w-0 flex-col gap-4 animate-in fade-in slide-in-from-left-2 duration-200 ease-out"
				>
					<SearchBar
						handleSearchChange={itemsContext.handleSearchChange}
						search={itemsContext.queryParams.search}
					/>
					{/* One line, always: the selects' own max-widths are lifted
					    and the wrappers split the width 60/40. */}
					<div className="flex min-w-0 flex-nowrap items-stretch gap-3">
						<div className="flex min-w-0 basis-3/5 [&>[data-slot=base]]:!max-w-none">
							<ScopeComponent itemsContext={itemsContext} />
						</div>
						<div className="flex min-w-0 basis-2/5 [&>[data-slot=base]]:!max-w-none">
							<SortComponent itemsContext={itemsContext} />
						</div>
						{extraFilters}
					</div>
					<FilterChips />
				</div>
			) : (
				<div
					key="sources-view"
					className="flex w-full min-w-0 flex-col gap-4 animate-in fade-in slide-in-from-right-2 duration-200 ease-out"
				>
					{bucketEntries.length > 0 ? (
						<BucketList entries={bucketEntries} />
					) : (
						<p className="rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-black/40 dark:border-white/10 dark:text-white/40">
							{tAI("sourcesEmpty")}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
