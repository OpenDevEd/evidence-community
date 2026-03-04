"use client";
import { ReactNode, use, useContext, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { AnimatePresence, motion } from "framer-motion";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/heroui/Button";
import { FaCompass, FaTrash } from "react-icons/fa";
import { ContentInteractions } from "@/components/pages/EvidenceLibrary";
import useBreakpoint from "@/hooks/useBreakpoint";
import { Skeleton } from "@/components/heroui/Skeleton";
import { Pagination } from "@/components/heroui/Pagination";
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
import { CardBody, useDisclosure } from "@heroui/react";
import { downloadItems } from "@/lib/actions";
import { routing, usePathname, useRouter } from "@/i18n/routing";
import { ItemsContext } from "../items/ItemsList";
import { countryFacetOptions } from "@/constants/misc";
import Image from "next/image";
import { getCountryInfo } from "@/lib/utils";
import { Item } from "@/app/api/item/types";
import { Card } from "@/components/heroui/Card";
import { Divider } from "@/components/heroui/Divider";
import { AiOutlineCompass } from "react-icons/ai";

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
			<span
				className={twMerge(
					"text-white dark:text-white/40 font-medium text-xs leading-3 dark:bg-black/50 bg-black/50 p-1 px-2 rounded-md",
					classNames.group
				)}
			>
				{group}
			</span>
			{startContent}
			<span className={twMerge("truncate text-wrap", classNames.title)}>
				{title}
			</span>
		</Button>
	);
}

function useFilterChips(
	queryParams: Record<string, any>,
	handleClearFilters?: () => void
) {
	const filtersCount =
		(queryParams.collections?.length || 0) +
		(queryParams.institution?.length || 0) +
		(queryParams.author ? 1 : 0) +
		countryFacetOptions.reduce(
			(acc, facet) => acc + (queryParams[facet.queryParam]?.length || 0),
			0
		);
	const clearButton = () => {
		handleClearFilters?.();
	};

	return {
		filtersCount,
		clearButton,
	};
}

function FilterChips() {
	const itemsContext = use(ItemsContext);
	const t = useTranslations("ui");
	const { filtersCount, clearButton } = useFilterChips(
		itemsContext.queryParams,
		itemsContext.handleClearFilters
	);

	return (
		<div
			className={twMerge(
				"flex max-h-0 overflow-y-hidden transition-all duration-200 opacity-0 mb-0",
				filtersCount > 0 && "max-h-[32rem] mb-4 opacity-100"
			)}
		>
			<div className="flex-1 flex gap-2 flex-wrap relative">
				<AnimatePresence initial={false} mode="popLayout">
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
											itemsContext[facet.action](value)
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
					{itemsContext.collectionsData &&
						itemsContext.queryParams.collections?.map(
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
											title={collectionData?.name ?? ""}
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
				</AnimatePresence>
			</div>
			<AnimatePresence initial={false}>
				{filtersCount > 0 && (
					<motion.div
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2 }}
						className="w-7 flex justify-end"
					>
						<Button
							aria-hidden={
								itemsContext.queryParams.collections.length == 0
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
}: {
	abstract: boolean;
	view: string;
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
						: "grid grid-cols-2"
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

function PaginationControls() {
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
			<div className="w-full flex justify-center py-2 lg:py-6 z-10">
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
	const itemsContext = use(ItemsContext);
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
	const { status } = useContext(CacheContext) as CacheContextType;

	return (
		<section
			id="main-content"
			className="w-full flex flex-col gap-4 overflow-hidden"
		>
			<NoteView />
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
			<ResourcesList abstract={abstract} view={view} />
			<PaginationControls />
			<ContentActions params={params} />
			<div className="text-center lg:text-end text-black/60 dark:text-white/60 text-sm">
				{t("lastUpdate", {
					date: format.dateTime(new Date(status.databaseUpdatedAt!), {
						day: "2-digit",
						month: "2-digit",
						year: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					}),
				})}
			</div>
		</section>
	);
}
