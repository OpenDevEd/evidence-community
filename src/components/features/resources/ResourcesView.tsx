"use client";
import { AiOutlineCompass } from "react-icons/ai";

import {
	AuthorProfilesContext,
	useAuthorProfiles,
} from "@/lib/authors/use-author-profiles";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	Alert02Icon,
	CodeSquareIcon,
	Delete02Icon,
	Download01Icon,
	Refresh01Icon,
} from "@hugeicons/core-free-icons";
import {
	ReactNode,
	type ComponentProps,
	use,
	useId,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { getLangDir } from "rtl-detect";
import { twMerge } from "tailwind-merge";
import {
	AnimatePresence,
	MotionConfig,
	motion,
	useAnimate,
	useReducedMotion,
} from "framer-motion";
import type { useItemsList } from "@/hooks/useItemsList";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/nextui/Button";
import { ContentInteractions } from "@/components/pages/EvidenceLibrary";
import useBreakpoint from "@/hooks/useBreakpoint";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Pagination } from "@/components/nextui/Pagination";
import { ITEMS_PER_PAGE } from "@/constants/items";
import Resource from "../items/Resource";
import { CacheContext, CacheContextType } from "@/context/Providers";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { DownloadModal } from "../newlib/DownloadModal";
import { CardBody, useDisclosure } from "@nextui-org/react";
import { ItemsContext } from "@/context/ItemsContext";
import { useFiltersContext } from "@/context/FiltersProvider";
import {
	EngagedLibraryPanel,
	type EngagedLibraryView,
} from "./EngagedLibraryPanel";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import InlineLibraryChat from "../ai/InlineLibraryChat";
import { countryFacetOptions } from "@/constants/misc";
import Image from "next/image";
import { getCountryInfo } from "@/lib/utils";
import { Item } from "@/app/api/item/types";
import { Card } from "@/components/nextui/Card";
import { Divider } from "@/components/nextui/Divider";
import {
	getDownloadableRecordCount,
	getEnabledCitationFormats,
	getLibraryExportPath,
} from "@/config/library-config/exports";
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
				classNames.button,
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
						classNames.group,
					)}
				>
					{group}
				</span>
			)}
			{startContent}
			<span
				className={twMerge(
					"block max-w-filter-chip truncate",
					classNames.title,
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

function getFilterChipState(
	queryParams: Record<string, any>,
	handleClearFilters?: () => void,
) {
	const filtersCount =
		(queryParams.collections?.length || 0) +
		(queryParams.institution?.length || 0) +
		(queryParams.author ? 1 : 0) +
		(queryParams.range ? 1 : 0) +
		countryFacetOptions.reduce(
			(acc, facet) => acc + (queryParams[facet.queryParam]?.length || 0),
			0,
		);
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
	const { filtersCount, clearButton } = getFilterChipState(
		itemsContext.queryParams,
		itemsContext.handleClearFilters,
	);

	return (
		<div
			className={twMerge(
				"flex max-h-0 overflow-y-hidden transition-all duration-200 opacity-0 mb-0",
				filtersCount > 0 && "max-h-filter-chips mb-4 opacity-100",
			)}
		>
			{/* On mobile the chips scroll horizontally inside their own track so a
			    long chip can't push the whole row (and the clear button) off-screen;
			    on sm+ they wrap as before. */}
			<div className="relative flex min-w-0 flex-1 gap-2 overflow-x-auto [&>div]:shrink-0 [scrollbar-width:none] sm:flex-wrap sm:overflow-x-visible [&::-webkit-scrollbar]:hidden">
				<AnimatePresence initial={false} mode="popLayout">
					{itemsContext.queryParams?.range && (
						<motion.div
							key={"year-" + itemsContext.queryParams.range}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{ duration: 0.2 }}
						>
							<Chip
								key={"year-" + itemsContext.queryParams.range}
								divKey={
									"year-" + itemsContext.queryParams.range
								}
								group={t("year")}
								title={yearChipTitle(
									itemsContext.queryParams.range,
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
													unoptimized
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
												value,
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
												institution,
											)
										}
										classNames={{
											button: "bg-accent/80 dark:bg-accent/80",
											title: "text-white dark:text-white",
										}}
									/>
								</motion.div>
							),
						)}
					{itemsContext.collectionsData &&
						itemsContext.selectedCollections?.map(
							(collection: string) => {
								const collectionData =
									itemsContext.collectionsData?.collections.find(
										(c) => c.key === collection,
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
													collection,
												)
											}
										/>
									</motion.div>
								);
							},
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
										itemsContext.queryParams.author,
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
							aria-label={t("clearFiltersAriaLabel")}
							onPress={clearButton}
							isIconOnly
							size="sm"
							variant="solid"
							color="accent"
							className="h-7 w-7 min-w-7"
						>
							<HugeiconsIcon
								icon={Delete02Icon}
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
	openLinksInNewTab = false,
}: {
	abstract: boolean;
	view: string;
	className?: string;
	openLinksInNewTab?: boolean;
}) {
	const itemsContext = use(ItemsContext);
	const { profiles } = useAuthorProfiles(
		itemsContext.itemsData?.items?.flatMap(
			(item: Item) => item.creators ?? [],
		),
	);

	const t = useTranslations("ui");
	const actuallyNoData =
		(!itemsContext.isItemsLoading &&
			itemsContext.itemsData &&
			itemsContext.itemsData.items.length === 0) ||
		itemsContext.itemsError;

	return (
		<AuthorProfilesContext value={profiles}>
			<ul
				className={twMerge(
					"gap-6 -mt-4",
					view === "list" || actuallyNoData
						? "flex flex-col"
						: "grid grid-cols-1 lg:grid-cols-2",
					className,
				)}
			>
				{itemsContext.itemsError ? (
					<li
						role="alert"
						className="flex flex-col items-center gap-4 py-12 text-center"
					>
						<div className="flex items-center gap-2 text-sm font-medium text-black/70 dark:text-white/70">
							<HugeiconsIcon
								icon={Alert02Icon}
								className="size-5 text-danger"
							/>
							{t("resourcesLoadFailed")}
						</div>
						<Button
							size="sm"
							isLoading={itemsContext.isItemsFetching}
							onPress={() =>
								void itemsContext.revalidateResults()
							}
							startContent={
								<HugeiconsIcon
									icon={Refresh01Icon}
									className="size-4"
								/>
							}
						>
							{t("retry")}
						</Button>
					</li>
				) : actuallyNoData ? (
					<li className="text-center text-black/40 dark:text-white/40 text-sm mb-4 py-12">
						{t("noResourcesFound")}
					</li>
				) : (
					Array.from({ length: ITEMS_PER_PAGE }).map(
						(_, index) =>
							(!itemsContext.itemsData ||
								(itemsContext.itemsData &&
									itemsContext.itemsData.items[index])) && (
								<Resource
									openLinksInNewTab={openLinksInNewTab}
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
								/>
							),
					)
				)}
			</ul>
		</AuthorProfilesContext>
	);
}

function ContentActions() {
	const t = useTranslations("ui");
	const format = useFormatter();
	const { status } = useContext(CacheContext) as CacheContextType;
	const totalItems = status.totalItems;
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const { exports, identity, citations } = useLibraryConfig();
	const isDownloadEnabled = useLibraryFeature("downloads");
	const isAtomFeedEnabled = useLibraryFeature("atomFeed");
	const availableFormats = getEnabledCitationFormats(exports);
	// The whole-library file stops at the cap, so the button shows the cap
	// rather than a number the download cannot deliver.
	const downloadableRecords = getDownloadableRecordCount(totalItems);

	return (
		<div className="lg:flex lg:justify-end grid gap-4 flex-wrap empty:hidden">
			<DownloadModal
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				onClose={onClose}
				hrefForFormat={getLibraryExportPath}
				citationPath="/api/exports/citation"
				formats={availableFormats}
				fileName={identity.shortName}
				description={t(
					totalItems > downloadableRecords
						? "downloadLibraryLimited"
						: "downloadLibraryDescription",
					{ count: downloadableRecords, total: totalItems },
				)}
			/>
			{isDownloadEnabled && (availableFormats.length > 0 || citations.enabled) && (
				<Button
					data-download-record-count={downloadableRecords}
					endContent={
						<HugeiconsIcon
							icon={Download01Icon}
							className="size-6"
						/>
					}
					onPress={onOpen}
				>
					{t("downloadLibrary")}{" "}
					<span className="opacity-60">
						{format.number(downloadableRecords)}
					</span>
				</Button>
			)}
			{isAtomFeedEnabled && exports.atom && (
				<Button
					onPress={() => {
						window.location.assign(getLibraryExportPath("atom"));
					}}
					endContent={
						<HugeiconsIcon
							icon={CodeSquareIcon}
							className="size-6"
						/>
					}
				>
					{t("mainFeed")}
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
				(n.textContent?.trim() ?? "") !== "",
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
		(c) => c.key === selectedCollection,
	);
	const isCollectionNoteEnabled = useLibraryFeature("collectionNotes");

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
													.note ?? "",
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

function animateResultsPlane(
	plane: HTMLElement,
	shadow: HTMLElement,
	animatePlane: ReturnType<typeof useAnimate>[1],
	engaged: boolean,
	isRTL: boolean,
) {
	const fromX = (engaged ? -PLANE_SHIFT : PLANE_SHIFT) * (isRTL ? -1 : 1);
	const fromScale = engaged ? PLANE_RECEDE_SCALE : PLANE_LIFT_SCALE;
	return [
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
}

function useSplitViewMotion(engaged: boolean, isRTL: boolean) {
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

	const [hasSwapped, setHasSwapped] = useState(false);
	const [swapBaseline] = useState(engaged);
	if (!hasSwapped && engaged !== swapBaseline) setHasSwapped(true);

	const [planeScope, animatePlane] = useAnimate<HTMLDivElement>();
	const prefersReducedMotion = useReducedMotion();

	const planePrevEngagedRef = useRef(engaged);
	useEffect(() => {
		if (planePrevEngagedRef.current === engaged) return;
		planePrevEngagedRef.current = engaged;
		if (prefersReducedMotion) return;
		const plane = planeScope.current as HTMLElement | null;
		const shadow = plane?.querySelector<HTMLElement>("[data-plane-shadow]");
		if (!plane || !shadow) return;
		const controls = animateResultsPlane(
			plane,
			shadow,
			animatePlane,
			engaged,
			isRTL,
		);
		return () => controls.forEach((c) => c.stop());
	}, [engaged, animatePlane, planeScope, prefersReducedMotion, isRTL]);
	return { showChat, hasSwapped, planeScope };
}

function useResultsAnalytics(itemsContext: ReturnType<typeof useItemsList>) {
	const lastTrackedResults = useRef<string | null>(null);

	useEffect(() => {
		if (
			itemsContext.itemsError ||
			!itemsContext.itemsData ||
			itemsContext.isItemsLoading ||
			itemsContext.isItemsFetching
		) {
			return;
		}

		const query = itemsContext.queryParams;
		const { filtersCount } = getFilterChipState(query);
		const categoricalFilters = {
			collection: query.collections,
			country: query.country,
			institution: query.institution,
			year_range: query.range,
		};
		const signature = JSON.stringify({
			categoricalFilters,
			page: query.page,
			search: Boolean(query.search?.trim()),
			scope: query.scope,
			sort: query.sort,
			total: itemsContext.itemsData.totalItems,
			items: itemsContext.itemsData.items.length,
			filtersCount,
		});
		if (lastTrackedResults.current === signature) return;
		lastTrackedResults.current = signature;

		trackLibraryResultsLoaded({
			hasSearch: Boolean(query.search?.trim()),
			filterCount: filtersCount,
			page: query.page,
			pageResultCount: itemsContext.itemsData.items.length,
			totalResultCount: itemsContext.itemsData.totalItems,
			scope: query.scope,
			sort: query.sort,
			categoricalFilters,
		});
	}, [
		itemsContext.itemsError,
		itemsContext.isItemsFetching,
		itemsContext.isItemsLoading,
		itemsContext.itemsData,
		itemsContext.queryParams,
	]);
}

function InlineChatColumn({
	engaged,
	modelId,
	searchContext,
}: {
	engaged: boolean;
	modelId: string;
	searchContext: ReturnType<typeof normalizeLibrarySearchContext> | undefined;
}) {
	const { theme } = useLibraryConfig();
	return (
		<div
			inert={!engaged || undefined}
			className={twMerge(
				"min-w-0 origin-bottom animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 lg:sticky lg:top-[4.75rem] motion-reduce:animate-none motion-reduce:transition-none lg:col-start-1 lg:row-start-1",

				theme.layout === "small"
					? "xl:top-[8.125rem]"
					: "xl:top-[6.5rem]",

				"lg:overflow-hidden",

				"transition-[opacity,transform] ease-in",

				engaged
					? "opacity-100"
					: "pointer-events-none translate-y-6 scale-[0.97] opacity-0",
			)}
		>
			<div className="lg:ms-auto lg:w-[calc((100cqw-1.5rem)*5/9)] xl:w-[calc((100cqw-2rem)*5/9)]">
				<InlineLibraryChat
					key={modelId}
					modelId={modelId}
					searchContext={searchContext}
				/>
			</div>
		</div>
	);
}

function LibraryResultsPanel({
	engaged,
	engagedView,
	idPrefix,
	abstract,
	view,
}: {
	engaged: boolean;
	engagedView: EngagedLibraryView;
	idPrefix: string;
	abstract: boolean;
	view: string;
}) {
	return (
		<div
			{...(engaged && {
				role: "tabpanel",
				"aria-labelledby": `${idPrefix}-tab-results`,
				tabIndex: 0,
			})}
			id={`${idPrefix}-results`}
			className={twMerge(
				"flex min-w-0 flex-col gap-4",
				engaged && engagedView === "sources" && "hidden",
			)}
		>
			<ResourcesList
				abstract={abstract}
				view={view}
				openLinksInNewTab={engaged}
				className={twMerge(engaged && "gap-4")}
			/>
			<PaginationControls
				className={twMerge(engaged && "py-0 lg:py-0")}
			/>
		</div>
	);
}

function LibraryResultsFooter() {
	const t = useTranslations("ui");
	const format = useFormatter();
	const { status } = useContext(CacheContext) as CacheContextType;
	return (
		<>
			<ContentActions />
			{status.latestPublicationUpdatedAt && (
				<div className="text-center lg:text-end text-black/60 dark:text-white/60 text-sm">
					{t("lastUpdate", {
						date: format.dateTime(
							new Date(status.latestPublicationUpdatedAt!),
							{
								timeZone: "UTC",
								day: "2-digit",
								month: "2-digit",
								year: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							},
						),
					})}
				</div>
			)}
		</>
	);
}

function LibraryControls({
	engaged,
	hasSwapped,
	engagedProps,
	normalProps,
}: {
	engaged: boolean;
	hasSwapped: boolean;
	engagedProps: ComponentProps<typeof EngagedLibraryPanel>;
	normalProps: ComponentProps<typeof ContentInteractions>;
}) {
	return engaged ? (
		<div
			key="engaged-panel"
			className={twMerge(
				"flex w-full min-w-0 flex-col gap-4",
				hasSwapped &&
					"animate-in fade-in slide-in-from-right-4 rtl:slide-in-from-left-4 duration-200 ease-out motion-reduce:animate-none",
			)}
		>
			<EngagedLibraryPanel {...engagedProps} key={engagedProps.modelId} />
		</div>
	) : (
		<div
			key="library-full"
			className={twMerge(
				"flex w-full min-w-0 flex-col gap-4",
				hasSwapped &&
					"animate-in fade-in slide-in-from-left-4 rtl:slide-in-from-right-4 duration-200 ease-out motion-reduce:animate-none",
			)}
		>
			<ContentInteractions {...normalProps} />
			<FilterChips />
		</div>
	);
}

function ResourcesViewFrame({
	contentId,
	engaged,
	showChat,
	isRTL,
	planeScope,
	chat,
	children,
}: {
	engaged: boolean;
	showChat: boolean;
	isRTL: boolean;
	planeScope: ReturnType<typeof useAnimate<HTMLDivElement>>[0];
	chat: ReactNode;
	children: ReactNode;
	contentId: string;
}) {
	const transformOrigin = isRTL ? "left center" : "right center";
	return (
		<MotionConfig reducedMotion="user">
			<section
				id={contentId}
				className={twMerge(
					"w-full flex flex-col gap-4",

					!engaged && "-mx-1 overflow-hidden px-1",
				)}
			>
				{!engaged && <NoteView />}

				<div
					className={twMerge(
						"w-full lg:grid lg:grid-cols-[minmax(0,0fr)_minmax(0,1fr)] lg:items-start lg:gap-x-0 lg:transition-[grid-template-columns,column-gap] lg:duration-split lg:ease-split lg:motion-reduce:transition-none lg:motion-reduce:delay-0",

						!engaged && "lg:delay-[80ms]",
						engaged &&
							"grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] lg:gap-x-6 xl:gap-x-8",
					)}
				>
					{showChat && chat}
					<div
						ref={planeScope}
						style={{ transformOrigin }}
						className="@container relative flex w-full min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1"
					>
						<div
							data-plane-shadow
							aria-hidden
							className="pointer-events-none absolute inset-x-[-0.75rem] top-[-0.75rem] -z-10 h-[calc(100dvh+1.5rem)] max-h-[calc(100%+1.5rem)] rounded-3xl opacity-0 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[0_40px_90px_-30px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.06)]"
						/>

						{engaged && <NoteView />}
						{children}
						{!engaged && <LibraryResultsFooter />}
					</div>
				</div>
			</section>
		</MotionConfig>
	);
}

export function ResourcesView({
	contentId = "main-content",
	extraFilters,
	params,
	countLabel,
	header,
}: {
	extraFilters: ReactNode;
	params?: Record<string, any>;
	countLabel?: ReactNode;
	header?: ReactNode;
	contentId?: string;
}) {
	const idPrefix = useId();
	const isRTL = getLangDir(useLocale()) === "rtl";
	const [abstract, setAbstract] = useState(true);
	const [view, setView] = useState("list");

	const [engagedView, setEngagedView] =
		useState<EngagedLibraryView>("results");
	const [engagedAbstract, setEngagedAbstract] = useState(false);
	const itemsContext = use(ItemsContext);

	const { engaged: chatEngaged } = useInlineChatLayout();
	const { selectedModelId } = useSelectedModel();
	const engaged =
		chatEngaged && !itemsContext.userData && Boolean(selectedModelId);

	const { showChat, hasSwapped, planeScope } = useSplitViewMotion(
		engaged,
		isRTL,
	);
	const searchContext = itemsContext.userData
		? undefined
		: normalizeLibrarySearchContext(itemsContext.queryParams);
	useResultsAnalytics(itemsContext);
	const resultAbstract = engaged ? engagedAbstract : abstract;
	const resultView = engaged ? "list" : view;

	return (
		<ResourcesViewFrame
			contentId={contentId}
			engaged={engaged}
			showChat={showChat}
			isRTL={isRTL}
			planeScope={planeScope}
			chat={
				<InlineChatColumn
					engaged={engaged}
					modelId={selectedModelId!}
					searchContext={searchContext}
				/>
			}
		>
			<LibraryControls
				engaged={engaged}
				hasSwapped={hasSwapped}
				engagedProps={{
					idPrefix,
					modelId: selectedModelId!,
					extraFilters,
					filterChips: <FilterChips />,
					view: engagedView,
					setView: setEngagedView,
					abstract: engagedAbstract,
					setAbstract: setEngagedAbstract,
				}}
				normalProps={{
					header,
					abstract,
					onAbstractChange: setAbstract,
					view,
					setView,
					countLabel,
					extraFilters,
				}}
			/>

			<LibraryResultsPanel
				engaged={engaged}
				engagedView={engagedView}
				idPrefix={idPrefix}
				abstract={resultAbstract}
				view={resultView}
			/>
		</ResourcesViewFrame>
	);
}

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
