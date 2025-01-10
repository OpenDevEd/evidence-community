"use client";
import { ReactNode, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
				onClick={() => {
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
						onClick={() => {
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
}: {
	data: ItemsGetResponse | undefined;
	error: any;
	isLoading: boolean;
	abstract: boolean;
	view: string;
}) {
	const t = useTranslations("ui");
	const actuallyNoData =
		(!isLoading && data && data.items.length === 0) || error;

	return (
		<>
			<div className={twMerge("gap-6 -mt-4", view === "list" ? "flex flex-col flex-col" : "grid grid-cols-2")}>
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
								/>
							)
					)
				)}
			</div>
		</>
	);
}

function ContentActions() {
	const t = useTranslations("ui");

	return (
		<div className="xl:flex xl:justify-end grid gap-4 flex-wrap">
			<Button endContent={<HiOutlineDownload className="size-6" />}>
				{t("downloadRecords", { count: "6,788" })}
			</Button>
			<Button endContent={<HiOutlinePrinter className="size-6" />}>
				{t("printCitations", { count: "5,654" })}
			</Button>
			<Button
				endContent={<HiOutlineCodeBracketSquare className="size-6" />}
			>
				{t("mainFeed")}
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
    selectedCollections,
    handleCheckboxChange,
    collectionsData,
    hierarchy,
    range,
    handleRangeChange,
    pageNumber,
    handlePageChange,
	countLabel,
}: ResourcesViewProps) {
    const t = useTranslations("ui");
    const [abstract, setAbstract] = useState(true);
	const [view, setView] = useState("list");

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
            />
            <PaginationControls
                page={pageNumber}
                setPage={handlePageChange}
                data={itemsData}
                error={itemsError}
                isLoading={isItemsLoading}
            />
            <ContentActions />
            <div className="text-center xl:text-end text-black/40 dark:text-white/40 text-sm">
                {t("lastUpdate", { date: "30/03/2024, 15:01" })}
            </div>
        </div>
    );
} 