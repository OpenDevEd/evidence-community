"use client";
import { ReactNode, useContext, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ItemsGetResponse } from "@/app/api/items/types";
import { CollectionsGetResponse } from "@/app/api/collections/types";
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
import { CacheContext, CacheContextType, useFeatureFlagEnabled } from "@/context/Providers";
import { DownloadModal } from "../items/ItemControls";
import { useDisclosure } from "@nextui-org/react";
import { downloadItems, searchIndex } from "@/lib/actions";
import { routing, usePathname, useRouter } from "@/i18n/routing";


interface ResourcesViewProps {
    sort: string;
    search: string;
    scope: string;
    handleSearchChange: (text: string) => void;
    handleScopeChange: (scope: Set<string>) => void;
    handleSortChange: (sort: Set<string>) => void;
    itemsData: ItemsGetResponse | undefined;
    itemsError: any;
    isItemsLoading: boolean;
    selectedCollections?: string[];
    handleCheckboxChange?: (key: string) => void;
    collectionsData?: CollectionsGetResponse | undefined;
    hierarchy?: any;
    range: string;
    handleRangeChange: (start: string | null, end: string | null) => void;
    pageNumber: number;
    handlePageChange: (newPage: number) => void;
    header?: ReactNode;
	countLabel?: ReactNode;
	queryParams?: Record<string, any>;
	params?: Record<string, any>;
	searchParams?: Record<string, any>;
	isItemsFetching?: boolean;
	revalidateResults?: any;
}

function Chip({
	collection,
	handleCheckboxChange,
	collectionsData,
}: {
	collection: string;
	handleCheckboxChange: (key: string) => void;
	collectionsData: CollectionsGetResponse | undefined;
}) {
	const collectionData = collectionsData?.collections.find(
		(c) => c.key === collection
	);
	const canClick = useRef(true);
	const [debounceCanClick] = useDebounce(() => {
		canClick.current = true;
	}, 1000);

	return (
		<motion.div
			key={collection}
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -10 }}
			transition={{ duration: 0.2 }}
		>
			<Button
				size="xs"
				variant="solid"
				className="shrink-0 p-1 h-auto ltr:pr-2 rtl:pl-2"
				onPress={() => {
					if (canClick.current) {
						handleCheckboxChange(collection);
						canClick.current = false;
					}
					debounceCanClick();
				}}
			>
				<span className="text-white dark:text-white/40 font-medium text-xs leading-3 dark:bg-black/50 bg-black/50 p-1 px-2 rounded-md">
					{collectionData?.title}
				</span>
				<span className="truncate text-wrap">
					{collectionData?.name}
				</span>
			</Button>
		</motion.div>
	);
}


function FilterChips({
	collections,
	handleCheckboxChange,
	collectionsData,
}: {
	collections?: string[];
	handleCheckboxChange?: (key: string) => void;
	collectionsData: CollectionsGetResponse | undefined;
}) {
	return (
		<div
			className={twMerge(
				"flex max-h-0 overflow-y-hidden transition-all duration-200 opacity-0 mb-0",
				collections && collections.length > 0 && "max-h-[32rem] mb-4 opacity-100"
			)}
		>
			<div className="flex-1 flex gap-2 flex-wrap">
				{handleCheckboxChange && (
					<AnimatePresence initial={false}>
						{collectionsData &&
							collections?.map((collection: string, index) => (
								<Chip
									key={collection}
									collection={collection}
									handleCheckboxChange={handleCheckboxChange}
								collectionsData={collectionsData}
							/>
						))}
					</AnimatePresence>
				)}
			</div>
			<AnimatePresence initial={false}>
				<motion.div
					initial={{ opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -10 }}
					transition={{ duration: 0.2 }}
					className="w-7 flex justify-end"
				>
					<Button
aria-hidden={collections?.length == 0}
						aria-label={"Clear all filters"}
						onPress={() => {
							handleCheckboxChange?.("");
						}}
						isIconOnly
						size="sm"
						variant="solid"
						color="accent"
						className="h-7 w-7 min-w-7"
					>
						<FaTrash className="text-white size-3" />
					</Button>
				</motion.div>
			</AnimatePresence>
		</div>
	);
}

function ResourcesList({
	data,
	error,
	isLoading,
	abstract,
	view,
	revalidateResults,
}: {
	data: ItemsGetResponse | undefined;
	error: any;
	isLoading: boolean;
	abstract: boolean;
	view: string;
	revalidateResults?: any;
}) {
	const t = useTranslations("ui");
	const actuallyNoData =
		(!isLoading && data && data.items.length === 0) || error;

	return (
		<>
			<div className={twMerge("gap-6 -mt-4", (view === "list" || actuallyNoData) ? "flex flex-col" : "grid grid-cols-2")}>
				{actuallyNoData ? (
					<div className="text-center text-black/40 dark:text-white/40 text-sm mb-4 py-12">
						{t("noResourcesFound")}
					</div>
				) : (
					Array.from({ length: ITEMS_PER_PAGE }).map(
						(_, index) =>
							(!data || (data && data.items[index])) && (
								<Resource
									key={index}
									itemData={data?.items[index]}
									abstract={abstract}
									isLoading={isLoading}
									revalidateResults={revalidateResults}
								/>
							)
					)
				)}
			</div>
		</>
	);
}

function ContentActions({ data, queryParams, params, searchParams }: { data: ItemsGetResponse | undefined, queryParams?: Record<string, any>, params?: Record<string, any>, searchParams?: Record<string, any> }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const totalItems = data?.totalItems || 0;
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const router = useRouter();
	const isPrintingEnabled = useFeatureFlagEnabled("print-button");
	const pathName = usePathname();

	return (
		<div className="xl:flex xl:justify-end grid gap-4 flex-wrap">
			<DownloadModal
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				onClose={onClose}
				action={async (format: "ris" | "bibtex") => {
					return await downloadItems(queryParams || {}, params || {}, format);
				}}
				fileName={format.number(totalItems) + " " + format.dateTime(new Date(), {
					day: "2-digit",
					month: "2-digit",
					year: "numeric",
				})}
			/>
			<Button endContent={<HiOutlineDownload className="size-6" />} onPress={onOpen}>
				{t("downloadRecords", { count: format.number(totalItems) })}
			</Button>
			<Button isDisabled={!isPrintingEnabled} endContent={<HiOutlinePrinter className="size-6" />}>
				{t("printCitations", { count: format.number(totalItems) })}
			</Button>
			<Button
				onClick={() => {
					router.push({
						pathname: pathName + "/atom.xml",
						query: searchParams,
					}, {
						locale: routing.defaultLocale
					})
				}}
				endContent={<HiOutlineCodeBracketSquare className="size-6" />}
			>
				{JSON.stringify(searchParams) == "{}" ? t("mainFeed") : t("customFeed")}
			</Button>
		</div>
	);
}

function PaginationControls({
	page,
	setPage,
	data,
	isLoading,
	error,
}: {
	page: number;
	setPage: (page: number) => void;
	data: ItemsGetResponse | undefined;
	isLoading: boolean;
	error: any;
}) {
	const totalPages = data?.totalPages || 0;
	const actuallyNoData =
		(!isLoading && data && data.items.length === 0) || error;
	const isDesktop = useBreakpoint("xl");

	return (
		!actuallyNoData && (
			<div className="w-full flex justify-center bg-background_light dark:bg-background py-2 xl:py-6 z-10">
				<Skeleton
					isLoaded={totalPages > 0}
					className="w-full h-14 rounded-2xl flex items-center justify-center"
				>
					{totalPages > 0 && (
						<Pagination
							showControls
							page={page}
							onChange={setPage}
							siblings={isDesktop ? 3 : 0}
							total={totalPages}
						/>
					)}
				</Skeleton>
			</div>
		)
	);
}

export function ResourcesView({
    header,
    sort,
    search,
    scope,
    handleSearchChange,
    handleScopeChange,
    handleSortChange,
    itemsData,
    itemsError,
    isItemsLoading,
	isItemsFetching,
    selectedCollections,
    handleCheckboxChange,
    collectionsData,
    hierarchy,
    range,
    handleRangeChange,
    pageNumber,
    handlePageChange,
	countLabel,
	queryParams,
	params,
	searchParams,
	revalidateResults,
}: ResourcesViewProps) {
    const t = useTranslations("ui");
	const format = useFormatter();
    const [abstract, setAbstract] = useState(true);
	const [view, setView] = useState("list");
	const { status } = useContext(CacheContext) as CacheContextType;

    return (
        <div className="w-full flex flex-col gap-4">
            <ContentInteractions
                header={header}
                sort={sort}
                search={search}
                scope={scope}
                onSearchChange={handleSearchChange}
                onScopeChange={handleScopeChange}
                onSortChange={handleSortChange}
                data={itemsData}
                abstract={abstract}
                onAbstractChange={setAbstract}
                selectedCollections={selectedCollections}
                handleCheckboxChange={handleCheckboxChange}
                collectionsData={collectionsData}
                hierarchy={hierarchy}
                isLoading={isItemsLoading}
                error={itemsError}
                range={range}
                handleRangeChange={handleRangeChange}
				view={view}
				setView={setView}
				countLabel={countLabel}
				isItemsFetching={isItemsFetching}
            />
            <FilterChips
                collections={selectedCollections!}
                handleCheckboxChange={handleCheckboxChange}
                collectionsData={collectionsData}
            />
            <ResourcesList
                data={itemsData}
                error={itemsError}
                isLoading={isItemsLoading}
                abstract={abstract}
				view={view}
				revalidateResults={revalidateResults}
            />
            <PaginationControls
                page={pageNumber}
                setPage={handlePageChange}
                data={itemsData}
                error={itemsError}
                isLoading={isItemsLoading}
            />
		<ContentActions data={itemsData} queryParams={queryParams} params={params} searchParams={searchParams}/>
            <div className="text-center xl:text-end text-black/40 dark:text-white/40 text-sm">
                {t("lastUpdate", { date: format.dateTime(status.databaseUpdatedAt!, {
					day: "2-digit",
					month: "2-digit",
					year: "numeric",
					hour: "2-digit",
					minute: "2-digit",
				}) })}
            </div>
        </div>
    );
} 