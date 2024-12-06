"use client";
import { Button } from "@/components/nextui/Button";
import Resource from "@/components/features/items/Resource";
import CollectionsList from "@/components/features/collections/CollectionsList";
import { IoSearch } from "react-icons/io5";
import { LuHelpCircle, LuX } from "react-icons/lu";
import { Select } from "@/components/nextui/Select";
import { Input } from "@/components/nextui/Input";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import {
	Modal,
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
	useDisclosure,
} from "@nextui-org/react";
import { Pagination } from "@/components/nextui/Pagination";
import { HiOutlineDownload, HiOutlinePrinter } from "react-icons/hi";
import { HiOutlineCodeBracketSquare } from "react-icons/hi2";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { useCallback, useRef, useState } from "react";
import { ItemsGetResponse } from "@/app/api/items/types";
import { Skeleton } from "@/components/nextui/Skeleton";
import { CollectionsGetResponse } from "@/app/api/collections/types";
import { useParamsState } from "@/hooks/useParamsState";
import { FaTrash } from "react-icons/fa";
import { AiOutlineCompass } from "react-icons/ai";
import { useHierarchy } from "@/hooks/useHierarchy";
import useBreakpoint from "@/hooks/useBreakpoint";
import { useDebounce } from "@/hooks/useDebounce";
import { AnimatePresence, motion } from "framer-motion";
import { twMerge } from "tailwind-merge";
import {
	ITEMS_PER_PAGE,
	SORT_OPTIONS,
	SCOPE_OPTIONS,
} from "@/constants/items";
import HelpModal from "@/components/features/modals/HelpModal";
import { SectionTitle } from "@/components/typography/SectionTitle";
import { buildItemsQuery } from "@/lib/utils";

function ContentInteractions({
	data,
	sort,
	onSortChange,
	scope,
	onScopeChange,
	search,
	onSearchChange,
	abstract,
	onAbstractChange,
	collectionsData,
	selectedCollections,
	handleCheckboxChange,
	hierarchy,
	isLoading,
	error,
}: {
	data: ItemsGetResponse | undefined;
	sort: string;
	onSortChange: (sort: any) => void;
	search: string;
	onSearchChange: (search: string) => void;
	scope: string;
	onScopeChange: (scope: any) => void;
	abstract: boolean;
	onAbstractChange: (abstract: boolean) => void;
	collectionsData: CollectionsGetResponse | undefined;
	isLoading: boolean;
	error: any;
} & ReturnType<typeof useHierarchy>) {
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
	const debouncedSearch = useDebounce(onSearchChange, 0);
	const actuallyNoData =
		(!isLoading && data && data.items.length === 0) || error;

	return (
		<>
			<div className="flex w-full flex-col xl:flex-row xl:justify-between xl:items-end h-24 xl:h-12 gap-4">
				<h1 className="text-black dark:text-white/60 font-medium text-2xl xl:text-3xl w-full xl:w-auto h-10 xl:h-12 flex justify-between items-end">
					Search
					<Button
						startContent={<AiOutlineCompass className="size-6" />}
						className="xl:hidden ml-auto h-full"
						onClick={onExploreOpen}
					>
						Explore
					</Button>
					<Modal
						hideCloseButton
						classNames={{
							base: "bg-background_light dark:bg-background my-0 mx-0 min-h-dvh",
							wrapper: "no-scrollbar",
						}}
						scrollBehavior="outside"
						isOpen={isExploreOpen}
						onOpenChange={onExploreOpenChange}
					>
						<ModalContent>
							{(onClose) => (
								<>
									<ModalHeader className="flex items-center justify-between gap-2 sticky top-0 bg-background_light dark:bg-background z-30">
										<SectionTitle>Explore</SectionTitle>
										<Button
											onClick={onClose}
											isIconOnly
											variant="transparent"
											className="xl:px-0 px-0 translate-x-2"
											startContent={
												<LuX className="size-6 text-black dark:text-white/80" />
											}
										/>
									</ModalHeader>
									<CollectionsList
										data={collectionsData}
										handleCheckboxChange={
											handleCheckboxChange
										}
										selectedCollections={
											selectedCollections
										}
										hierarchy={hierarchy}
										isModal
									/>
								</>
							)}
						</ModalContent>
					</Modal>
				</h1>
				<div className="flex gap-4 h-10 xl:h-12 flex-1 justify-end">
					<Button
						className="h-full font-medium text-base"
						endContent={<LuHelpCircle className="size-6" />}
						onClick={onHelpOpen}
					>
						Help
					</Button>
					<HelpModal
						isOpen={isHelpOpen}
						onOpenChange={onHelpOpenChange}
					/>
					<Select
						items={SORT_OPTIONS}
						selectedKeys={sort && [sort]}
						onSelectionChange={onSortChange}
						classNames={{
							mainWrapper: "h-full",
							base: "flex-1 max-w-full xl:max-w-56",
						}}
						startContent={
							<>
								<div className="text-black/60 dark:text-white/40 shrink-0 font-medium">
									Sort by:
								</div>
							</>
						}
					>
						{(item: any) => {
							return (
								<SelectItem key={item.key}>
									{item.name}
								</SelectItem>
							);
						}}
					</Select>
				</div>
			</div>
			<div className="flex flex-col xl:flex-row gap-4">
				<Input
					autoComplete="false"
					defaultValue={search}
					onChange={(e) => debouncedSearch(e.target.value)}
					onClear={() => debouncedSearch("")}
					placeholder="Search"
					size={"lg"}
					classNames={{
						inputWrapper: "h-10 xl:h-12 min-h-10 xl:min-h-12",
					}}
					isClearable
					startContent={
						<IoSearch className="size-6 fill-current text-black/60 dark:text-white/40" />
					}
				/>
				<Select
					items={SCOPE_OPTIONS}
					selectedKeys={scope && [scope]}
					onSelectionChange={onScopeChange}
					color="tertiary"
					size="md"
					classNames={{
						base: "xl:max-w-72 w-full max-w-full",
						mainWrapper: "h-10 xl:h-full",
					}}
				>
					{(item: any) => {
						return (
							<SelectItem key={item.key}>{item.name}</SelectItem>
						);
					}}
				</Select>
			</div>
			<div className="flex justify-between h-10 xl:h-12 gap-4">
				<Skeleton
					isLoaded={!isLoading}
					className="flex items-center flex-1 rounded-2xl"
				>
					<h2 className="text-black dark:text-white/80 text-lg leading-[1.125rem] flex items-center gap-2">
						<span className="text-2xl leading-6">
							{actuallyNoData
								? "0"
								: data?.totalItems.toLocaleString()}
						</span>
						Resources
					</h2>
				</Skeleton>
				<Card className="h-full flex items-center justify-center">
					<div className="xl:px-3 px-1">
						<Switch
							size="sm"
							isSelected={abstract}
							onValueChange={onAbstractChange}
							classNames={{
								base: "flex-row-reverse",
							}}
						>
							Abstract
						</Switch>
					</div>
				</Card>
			</div>
		</>
	);
}

function ResourcesList({
	data,
	error,
	isLoading,
	abstract,
}: {
	data: ItemsGetResponse | undefined;
	error: any;
	isLoading: boolean;
	abstract: boolean;
}) {
	const actuallyNoData =
		(!isLoading && data && data.items.length === 0) || error;

	return (
		<>
			<div className="flex flex-col gap-6 -mt-4">
				{actuallyNoData ? (
					<div className="text-center text-black/40 dark:text-white/40 text-sm mb-4 py-12">
						No resources found
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
	return (
		<div className="xl:flex xl:justify-end grid gap-4 flex-wrap">
			<Button endContent={<HiOutlineDownload className="size-6" />}>
				Download 6,788 Records
			</Button>
			<Button endContent={<HiOutlinePrinter className="size-6" />}>
				Print 5,654 Citations
			</Button>
			<Button
				endContent={<HiOutlineCodeBracketSquare className="size-6" />}
			>
				Main Feed
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
	const debounceCanClick = useDebounce(() => {
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
				className="shrink-0"
				onClick={() => {
					if (canClick.current) {
						handleCheckboxChange(collection);
						canClick.current = false;
					}
					debounceCanClick();
				}}
			>
				{collectionData?.name}
				<span className="text-black/80 dark:text-white/40 font-medium text-sm leading-3">
					{`(${collectionData?.numItems})`}
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
	collections: string[];
	handleCheckboxChange: (key: string) => void;
	collectionsData: CollectionsGetResponse | undefined;
}) {
	return (
		<div
			className={twMerge(
				"flex max-h-0 overflow-y-hidden transition-all duration-200 opacity-0 mb-0",
				collections.length > 0 && "max-h-[512px] mb-4 opacity-100"
			)}
		>
			<div className="flex-1 flex gap-2 flex-wrap">
				<AnimatePresence>
					{collectionsData &&
						collections.map((collection: string, index) => (
							<Chip
								key={collection}
								collection={collection}
								handleCheckboxChange={handleCheckboxChange}
								collectionsData={collectionsData}
							/>
						))}
				</AnimatePresence>
			</div>
			<motion.div
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -10 }}
				transition={{ duration: 0.2 }}
				className="w-8 flex justify-end"
			>
				<Button
					onClick={() => {
						handleCheckboxChange("");
					}}
					isIconOnly
					size="sm"
					variant="solid"
					color="accent"
				>
					<FaTrash className="text-white size-3" />
				</Button>
			</motion.div>
		</div>
	);
}

function MainContent({ searchParams }: { searchParams: { [key: string]: any } }) {
	const { router, pathname, createQueryString } =
		useParamsState(searchParams);

const collectionsParam = searchParams["collections"];
	const collections = collectionsParam ? collectionsParam.split(",") : [];
	const pageNumber = Number(searchParams["page"]) || 1;
	const sort = searchParams["sort"] || SORT_OPTIONS[0].key;
	const search = searchParams["search"] || "";
	const scope = searchParams["scope"] || SCOPE_OPTIONS[0].key;
	const scope = searchParams.get("scope") || SCOPE_OPTIONS[0].key;

	const [abstract, setAbstract] = useState(true);

	const handlePageChange = useCallback(
		(newPage: number) => {
			router.push(
				createQueryString(pathname, [["page", String(newPage)]])
			);
		},
		[router, pathname, createQueryString]
	);

	const handleSortChange = useCallback(
		(sort: Set<string>) => {
			const value = sort.values().next().value;
			if (value)
				router.push(createQueryString(pathname, [["sort", value]]));
		},
		[router, pathname, createQueryString]
	);

	const handleScopeChange = useCallback(
		(scope: Set<string>) => {
			const value = scope.values().next().value;
			if (value)
				router.push(createQueryString(pathname, [["scope", value]]));
		},
		[router, pathname, createQueryString]
	);

	const handleSearchChange = useCallback(
		(text: string) =>
			router.push(
				createQueryString(pathname, [
					["search", text],
					["page", "1"],
				])
			),
		[router, pathname, createQueryString]
	);

	const {
		data: itemsData,
		error: itemsError,
		isLoading: isItemsLoading,
	} = useSWR<ItemsGetResponse>(
		buildItemsQuery({
			pageNumber,
			sort,
			collections,
			search,
			scope,
		}),
		fetcher,
		{
			keepPreviousData: true,
			onSuccess: (data) => {
				if (data.totalPages < pageNumber) {
					handlePageChange(data.totalPages);
				}
			},
		}
	);

	const {
		data: collectionsData,
		error: collectionsError,
		isLoading: isCollectionsLoading,
	} = useSWR<CollectionsGetResponse>("/collections", fetcher);

	const { hierarchy, handleCheckboxChange, selectedCollections } =
		useHierarchy({
			data: collectionsData,
searchParams,
		});

	return (
		<>
			<CollectionsList
				data={collectionsData}
				handleCheckboxChange={handleCheckboxChange}
				selectedCollections={selectedCollections}
				hierarchy={hierarchy}
			/>
			<div className="w-full flex flex-col gap-4">
				<ContentInteractions
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
				/>
				<FilterChips
					collections={selectedCollections}
					handleCheckboxChange={handleCheckboxChange}
					collectionsData={collectionsData}
				/>
				<ResourcesList
					data={itemsData}
					error={itemsError}
					isLoading={isItemsLoading}
					abstract={abstract}
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
					Last update from database: 30/03/2024, 15:01 (UTC)
				</div>
			</div>
		</>
	);
}

export default function EvidenceLibrary({ searchParams }: { searchParams: { [key: string]: any } }) {
	return (
		<main className="w-full max-w-screen-2xl px-4 xl:px-14">
			<div className="flex gap-[40px] flex-col xl:flex-row">
				<MainContent searchParams={searchParams} />
			</div>
		</main>
	);
}
