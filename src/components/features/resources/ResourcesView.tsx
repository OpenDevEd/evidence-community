"use client";
import { ReactNode, use, useContext, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { AnimatePresence, motion } from "framer-motion";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/nextui/Button";
import { FaTrash } from "react-icons/fa";
import { ContentInteractions } from "@/components/pages/EvidenceLibrary";
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
import { useDisclosure } from "@nextui-org/react";
import { downloadItems } from "@/lib/actions";
import { routing, usePathname, useRouter } from "@/i18n/routing";
import { ItemsContext } from "../items/ItemsList";
import { countryFacetOptions } from "@/constants/misc";
import Image from "next/image";
import { getCountryInfo } from "@/lib/utils";

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
		(queryParams.institution ? 1 : 0) +
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
					{itemsContext.queryParams?.institution && (
						<motion.div
							key={
								"institution-" +
								itemsContext.queryParams.institution
							}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{ duration: 0.2 }}
						>
							<Chip
								key={
									"institution-" +
									itemsContext.queryParams.institution
								}
								group={"Institution"}
								title={itemsContext.queryParams.institution}
								divKey={
									"institution-" +
									itemsContext.queryParams.institution
								}
								callback={() =>
									itemsContext.handleInstitutionSelect?.(
										itemsContext.queryParams.institution
									)
								}
								classNames={{
									button: "bg-accent/80 dark:bg-accent/80",
									title: "text-white dark:text-white",
								}}
							/>
						</motion.div>
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
											countryName && <Image
												src={`https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`}
												alt={value}
												width={16}
												height={12}
												className="ml-0.5"
											/>
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
	const isPrintingEnabled = useFeatureFlagEnabled("print-button");
	const pathName = usePathname();

	return (
		<div className="lg:flex lg:justify-end grid gap-4 flex-wrap">
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
			<Button
				endContent={<HiOutlineDownload className="size-6" />}
				onPress={onOpen}
			>
				{t("downloadRecords", { count: format.number(totalItems) })}
			</Button>
			<Button
				isDisabled={!isPrintingEnabled}
				endContent={<HiOutlinePrinter className="size-6" />}
			>
				{t("printCitations", { count: format.number(totalItems) })}
			</Button>
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
				endContent={<HiOutlineCodeBracketSquare className="size-6" />}
			>
				{JSON.stringify(itemsContext.searchParams) == "{}"
					? t("mainFeed")
					: t("customFeed")}
			</Button>
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
		<section id="main-content" className="w-full flex flex-col gap-4">
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
					date: format.dateTime(status.databaseUpdatedAt!, {
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
