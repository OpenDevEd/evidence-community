"use client";

import {
	AuthorProfilesContext,
	useAuthorProfiles,
} from "@/lib/authors/use-author-profiles";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	Alert02Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	CodeSquareIcon,
	Delete02Icon,
	Download01Icon,
	Folder01Icon,
	Refresh01Icon,
} from "@hugeicons/core-free-icons";
import {
	ReactNode,
	type ComponentProps,
	type ContextType,
	use,
	useId,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { getLangDir } from "rtl-detect";
import { twMerge } from "@/lib/tw-merge";
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
import { OpenInOpenScholar } from "@/components/features/openscholar/OpenInOpenScholar";
import { searchOf, type OpenScholarHandoff } from "@/lib/openscholar/handoff";
import { ContentInteractions } from "@/components/pages/EvidenceLibrary";
import useBreakpoint from "@/hooks/useBreakpoint";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Pagination } from "@/components/nextui/Pagination";
import { ITEMS_PER_PAGE } from "@/constants/items";
import { lastNumberedPage } from "@/lib/search-query";
import Resource from "../items/Resource";
import { CacheContext, CacheContextType } from "@/context/Providers";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { DownloadModal } from "../newlib/DownloadModal";
import { CardBody, Radio, RadioGroup, useDisclosure } from "@nextui-org/react";
import { ItemsContext } from "@/context/ItemsContext";
import { useFiltersContext } from "@/context/FiltersProvider";
import {
	EngagedLibraryPanel,
	type EngagedLibraryView,
} from "./EngagedLibraryPanel";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { AskHandedOverQuestion } from "@/components/features/ai/useHandedOverQuestion";
import InlineLibraryChat from "../ai/InlineLibraryChat";
import { FilterChips } from "./FilterChips";
import { chosenFilterCount } from "@/lib/searchParams";
export { FilterChips };
import { countryFacetOptions } from "@/constants/misc";
import Image from "next/image";
import { getCountryInfo } from "@/lib/utils";
import { Item } from "@/app/api/item/types";
import { Card } from "@/components/nextui/Card";
import { Divider } from "@/components/nextui/Divider";
import {
	LIBRARY_EXPORT_RECORD_CAP,
	getEnabledCitationFormats,
	getLibraryExportPath,
} from "@/config/library-config/exports";
import { trackLibraryResultsLoaded } from "@/lib/analytics";



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
									position={index}
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

function captureExportResults(items: ReturnType<typeof useItemsList>): { context: ReturnType<typeof normalizeLibrarySearchContext>; count: number } | null {
	if (items.isItemsFetching || items.itemsError || !items.itemsData) return null;
	const params = items.queryParams;
	// Select fields without repairing malformed values: the export endpoint must refuse them.
	return { context: {
		search: params.search, scope: params.scope, sort: params.sort, range: params.range,
		institution: params.institution, country: params.country, author_country: params.author_country, author: params.author,
		collections: params.collections, topics: params.topics, sources: params.sources, type: params.type, study: params.study,
		tags: params.tags, match: params.match,
		readerList: items.userData ? { userId: items.userData.id, collectionId: params.collectionId ?? "" } : null,
	}, count: items.itemsData.totalItems };
}

function exportDownloadDetails(scope: "results" | "library", libraryCount: number, held: ReturnType<typeof captureExportResults>) {
	if (scope === "results") return {
		request: { scope, context: held?.context },
		count: held?.count ?? 0,
		tooLarge: false,
		description: "downloadDescription",
	};
	const tooLarge = libraryCount > LIBRARY_EXPORT_RECORD_CAP;
	return {
		request: { scope, expectedCount: libraryCount },
		count: libraryCount,
		tooLarge,
		description: tooLarge ? "exportTooLarge" : "downloadLibraryDescription",
	};
}

function LibraryDownload() {
	const t = useTranslations("ui");
	const format = useFormatter();
	const { status } = useContext(CacheContext) as CacheContextType;
	const totalItems = status.totalItems;
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const { exports, identity, citations } = useLibraryConfig();
	const availableFormats = getEnabledCitationFormats(exports);
	const items = use(ItemsContext);
	const [scope, setScope] = useState<"results" | "library">("results");
	const [held, setHeld] = useState<{ context: ReturnType<typeof normalizeLibrarySearchContext>; count: number } | null>(null);
	const [libraryCount, setLibraryCount] = useState(totalItems);
	const download = exportDownloadDetails(scope, libraryCount, held);
	const openDownload = () => {
		const results = captureExportResults(items);
		setHeld(results);
		setLibraryCount(totalItems);
		setScope(results ? "results" : "library");
		onOpen();
	};

	return (
		<>
			<DownloadModal
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				onClose={onClose}
				source={{
					hrefForFormat: (format) => `/api/exports/${format}`,
					citationPath: "/api/exports/citation",
					formats: availableFormats,
					fileName: `${identity.shortName}-${scope}`,
					requestInit: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(download.request) },
				}}
				isDisabled={download.tooLarge || download.count === 0}
				description={t(download.description, { count: download.count })}
			>
				{(busy) => <RadioGroup aria-label={t("exportScope")} value={scope} onValueChange={(value) => setScope(value as "results" | "library")} isDisabled={busy}>
					<Radio value="results" isDisabled={!held}>{t("exportCurrentResults")}{held ? ` (≈${format.number(held.count)})` : ""}</Radio>
					<Radio value="library">{t("exportWholeLibrary")} ({format.number(libraryCount)})</Radio>
				</RadioGroup>}
			</DownloadModal>
			{(availableFormats.length > 0 || citations.enabled) && (
				<Button
					endContent={
						<HugeiconsIcon
							icon={Download01Icon}
							className="size-6"
						/>
					}
					onPress={openDownload}
				>
					{t("download")}
				</Button>
			)}
		</>
	);
}

function ContentActions() {
	const t = useTranslations("ui");
	const { exports } = useLibraryConfig();
	const isDownloadEnabled = useLibraryFeature("downloads");
	const isAtomFeedEnabled = useLibraryFeature("atomFeed");
	const items = use(ItemsContext);
	const params = items.queryParams;
	// A reader's collection goes as itself, or as the search inside it; the library's results as the search they are.
	// A reader's page with no collection open is no source: OpenScholar reads a collection of theirs, not all of it.
	const collectionId = items.userData ? params.collectionId : null;
	const handoff = (): OpenScholarHandoff => {
		// What the search box holds is the search, though its wait hasn't run it yet: a press right after typing sends it.
		const typed = items.readTypedSearch();
		const search = searchOf(typed === null ? params : { ...params, search: typed });
		if (!collectionId) return { from: "search", source: { search }, fields: [] };
		return { from: "collection", source: search ? { search, readerCollection: collectionId } : { readerCollection: collectionId }, fields: [] };
	};
	return (
		<div className="lg:flex lg:justify-end grid gap-4 flex-wrap empty:hidden">
			{items.userData && !collectionId ? null : <OpenInOpenScholar label={t("openInOpenScholar")} handoff={handoff} />}
			{isDownloadEnabled && <LibraryDownload />}
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

/**
 * Pages past the numbered ones: the first page, the pages either side, and where the reader is. Each side is reached
 * from the cursor this page's results gave, so it waits until they have loaded.
 */
function CursorPager({ numbered }: { numbered: number }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const { itemsData, queryParams, handlePageChange } = use(ItemsContext);
	const page = queryParams.page;
	const cursors = itemsData?.currentPage === page ? itemsData.cursors : undefined;
	const goBack = () =>
		page - 1 <= numbered ? handlePageChange(page - 1) : handlePageChange(page - 1, { before: cursors?.previous ?? undefined });
	return (
		<div className="flex flex-wrap items-center justify-center gap-3">
			<Button onPress={() => handlePageChange(1)}>{t("pageNumber", { page: format.number(1) })}</Button>
			<Button
				isDisabled={!cursors?.previous}
				onPress={goBack}
				startContent={<HugeiconsIcon icon={ArrowLeft01Icon} className="size-5 rtl:rotate-180" />}
			>
				{t("previous")}
			</Button>
			<span aria-current="page" className="px-2 font-medium tabular-nums">
				{t("pageNumber", { page: format.number(page) })}
			</span>
			<Button
				isDisabled={!cursors?.next}
				onPress={() => handlePageChange(page + 1, { after: cursors?.next ?? undefined })}
				endContent={<HugeiconsIcon icon={ArrowRight01Icon} className="size-5 rtl:rotate-180" />}
			>
				{t("next")}
			</Button>
		</div>
	);
}

/** The numbered pages, and past the last of them while more results follow, the way on to the next page. */
function NumberedPager({ numbered, totalPages }: { numbered: number; totalPages: number }) {
	const t = useTranslations("ui");
	const { itemsData, queryParams, handlePageChange, config } = use(ItemsContext);
	const isDesktop = useBreakpoint("xl");
	const page = queryParams.page;
	// The cursor is this page's own once its results have loaded.
	const loaded = itemsData?.currentPage === page;
	const next = page === numbered && numbered < totalPages && loaded ? itemsData?.cursors?.next : null;
	return (
		<div className="flex flex-wrap items-center justify-center gap-4">
			<Pagination
				showControls
				page={page}
				onChange={(newPage) => handlePageChange(newPage)}
				siblings={config.paginationSiblings || (isDesktop ? 3 : 0)}
				total={numbered}
			/>
			{next && (
				<Button
					onPress={() => handlePageChange(page + 1, { after: next })}
					endContent={<HugeiconsIcon icon={ArrowRight01Icon} className="size-5 rtl:rotate-180" />}
				>
					{t("next")}
				</Button>
			)}
		</div>
	);
}

function PaginationControls({ className }: { className?: string }) {
	const itemsContext = use(ItemsContext);
	const totalPages = itemsContext.itemsData?.totalPages || 0;
	// On Elasticsearch page numbers reach the first 10,000 results; past them a reader moves with next and previous.
	const { resultLimit } = useLibraryConfig();
	const numbered = Math.min(totalPages, lastNumberedPage(itemsContext.itemsData?.perPage ?? ITEMS_PER_PAGE, resultLimit));
	const actuallyNoData =
		(!itemsContext.isItemsLoading &&
			itemsContext.itemsData &&
			itemsContext.itemsData.items.length === 0) ||
		itemsContext.itemsError;

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
					// At least one row: past page 500 on a phone the pager takes two.
					className="w-full min-h-14 rounded-2xl flex items-center justify-center"
					// Without it the pager's own sideways scroll never starts: its width pushed the row past the page, cut off at both ends.
					classNames={{ content: "min-w-0" }}
				>
					{totalPages > 0 &&
						(itemsContext.queryParams.page > numbered ? (
							<CursorPager numbered={numbered} />
						) : (
							<NumberedPager numbered={numbered} totalPages={totalPages} />
						))}
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
											<HugeiconsIcon icon={Folder01Icon} className="size-4 shrink-0" />
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
		const filtersCount = chosenFilterCount(query);
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
		// The column enters with an animation and leaves with a transition, on
		// two elements: on one they fight over opacity and transform, and
		// Firefox jumps when the animation ends.
		<div
			inert={!engaged || undefined}
			className={twMerge(
				"min-w-0 origin-bottom animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 lg:sticky lg:top-[4.75rem] motion-reduce:animate-none lg:col-start-1 lg:row-start-1",

				theme.layout === "small"
					? "xl:top-[8.125rem]"
					: "xl:top-[6.5rem]",

				"lg:overflow-hidden",
			)}
		>
			<div
				className={twMerge(
					"origin-bottom transition-[opacity,transform] duration-300 ease-in motion-reduce:transition-none",
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
				// The server's Node and the browser can format the same date differently: in Arabic, Node puts a comma between
				// the date and the time and Chromium doesn't. The server's text stays, instead of React discarding the server's HTML.
				<div suppressHydrationWarning className="text-center lg:text-end text-black/60 dark:text-white/60 text-sm">
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

/** What the library's own search asks, for its chat; nothing on a reader's list. */
function librarySearchContext(itemsContext: ContextType<typeof ItemsContext>) {
	return itemsContext.userData ? undefined : normalizeLibrarySearchContext(itemsContext.queryParams);
}

export function ResourcesView({
	contentId = "main-content",
	extraFilters,
	params,
	countLabel,
	header,
	headless,
}: {
	extraFilters: ReactNode;
	params?: Record<string, any>;
	countLabel?: ReactNode;
	header?: ReactNode;
	headless?: boolean;
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
	const searchContext = librarySearchContext(itemsContext);
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
			<AskHandedOverQuestion searchContext={searchContext} />
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
					headless,
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
