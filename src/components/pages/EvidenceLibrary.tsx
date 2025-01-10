"use client";
import { Button } from "@/components/nextui/Button";
import CollectionsList from "@/components/features/collections/CollectionsList";
import { IoGrid, IoSearch } from "react-icons/io5";
import { LuChevronDown, LuX } from "react-icons/lu";
import { Select } from "@/components/nextui/Select";
import { Input } from "@/components/nextui/Input";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import {
	Modal,
	ModalContent,
	ModalHeader,
	useDisclosure,
} from "@nextui-org/react";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { ItemsGetResponse } from "@/app/api/items/types";
import { Skeleton } from "@/components/nextui/Skeleton";
import { CollectionsGetResponse } from "@/app/api/collections/types";
import { useParamsState } from "@/hooks/useParamsState";
import { AiOutlineCompass } from "react-icons/ai";
import { useHierarchy } from "@/hooks/useHierarchy";
import { useDebounce } from "@/hooks/useDebounce";
import { SORT_OPTIONS, SCOPE_OPTIONS } from "@/constants/items";
import HelpModal from "@/components/features/modals/HelpModal";
import { SectionTitle } from "@/components/typography/SectionTitle";
import { buildItemsQuery } from "@/lib/utils";
import { useFormatter, useTranslations } from "next-intl";
import { CacheContext } from "@/context/Providers";
import { ResourcesView } from "../features/resources/ResourcesView";
import { GiArchiveResearch } from "react-icons/gi";
import { FaSort, FaThList } from "react-icons/fa";
import { IoMdListBox } from "react-icons/io";
import { HiOutlineViewList } from "react-icons/hi";
import { BiHelpCircle } from "react-icons/bi";

function DropDownIcon(Icon: any) {
	return (
		<div className="size-8 bg-white/10 rounded-full p-2 aspect-square shrink-0">
			<Icon className="w-full h-full" />
		</div>
	);
}

export function ContentInteractions({
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
	range,
	view,
	setView,
	handleRangeChange,
	header,
	countLabel,
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
	range: string;
	view: string;
	setView: (view: string) => void;
	handleRangeChange: (start: string | null, end: string | null) => void;
	header?: ReactNode;
	countLabel?: ReactNode;
} & Partial<ReturnType<typeof useHierarchy>>) {
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
	const [debouncedSearch, _] = useDebounce(onSearchChange, 0);
	const actuallyNoData =
		(!isLoading && data && data.items.length === 0) || error;
	const t = useTranslations("ui");
	const tSorts = useTranslations("sorts");
	const tScopes = useTranslations("scopes");
	const formatter = useFormatter();

	const SortComponent = useMemo(() => {
		return (
			<Select
				startContent={DropDownIcon(FaSort)}
				selectedKeys={sort && [sort]}
				onSelectionChange={onSortChange}
				items={SORT_OPTIONS}
				selectorIcon={<div className="hidden"></div>}
				classNames={
					handleCheckboxChange
						? {
								mainWrapper: "h-full",
								base: "flex-1 max-w-full xl:max-w-56 shrink-0",
						  }
						: {}
				}
			>
				{(item: any) => {
					return (
						<SelectItem key={item.key}>
							{tSorts(item.key)}
						</SelectItem>
					);
				}}
			</Select>
		);
	}, [sort, onSortChange, handleCheckboxChange]);

	const ScopeComponent = useMemo(() => {
		return (
			<Select
				startContent={DropDownIcon(GiArchiveResearch)}
				color="tertiary"
				selectedKeys={scope && [scope]}
				onSelectionChange={onScopeChange}
				items={SCOPE_OPTIONS}
				selectorIcon={<div className="hidden"></div>}
				classNames={
					handleCheckboxChange
						? {
								base: "xl:max-w-72 w-full max-w-full",
								mainWrapper: "h-10 xl:h-full",
						  }
						: {}
				}
			>
				{(item: any) => {
					return (
						<SelectItem key={item.key}>
							{tScopes(item.key)}
						</SelectItem>
					);
				}}
			</Select>
		);
	}, [scope, onScopeChange, handleCheckboxChange]);

	return (
		<>
			{(handleCheckboxChange || header) && (
				<div className="flex w-full flex-col xl:flex-row xl:justify-between xl:items-end h-24 xl:h-12 gap-4">
					<h1 className="text-black dark:text-white/60 font-medium text-2xl xl:text-3xl w-full xl:w-auto h-10 xl:h-12 flex justify-between items-end">
						{header || t("searchTitle")}
						<Button
							startContent={
								<AiOutlineCompass className="size-6" />
							}
							className="xl:hidden ml-auto rtl:ml-0 rtl:mr-auto h-full"
							onClick={onExploreOpen}
						>
							{t("explore")}
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
								{(onClose: any) => (
									<>
										<ModalHeader className="flex items-center justify-between gap-2 sticky top-0 bg-background_light dark:bg-background z-30">
											<SectionTitle>
												{t("explore")}
											</SectionTitle>
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
										{handleCheckboxChange && (
											<CollectionsList
												data={collectionsData}
												handleCheckboxChange={
													handleCheckboxChange
												}
												selectedCollections={
													selectedCollections
												}
												hierarchy={hierarchy!}
												isModal
												range={range}
												handleRangeChange={
													handleRangeChange
												}
												facetDistribution={
													data?.facetDistribution
												}
											/>
										)}
									</>
								)}
							</ModalContent>
						</Modal>
					</h1>
					<div className="flex gap-4 h-10 xl:h-12 flex-1 justify-end">
						{handleCheckboxChange && (
							<>
								<Button
									className="h-full font-medium text-base !p-0"
									isIconOnly
									onClick={onHelpOpen}
								>
									<BiHelpCircle className="size-6" />
								</Button>
								<HelpModal
									isOpen={isHelpOpen}
									onOpenChange={onHelpOpenChange}
								/>
								{SortComponent}
							</>
						)}
					</div>
				</div>
			)}
			<div className="flex flex-col xl:flex-row gap-4">
				<Input
					autoComplete="false"
					defaultValue={search}
					onChange={(e) => debouncedSearch(e.target.value)}
					onClear={() => debouncedSearch("")}
					placeholder={t("search")}
					size={"lg"}
					classNames={{
						inputWrapper: "h-10 xl:h-12 min-h-10 xl:min-h-12",
					}}
					isClearable
					startContent={
						<IoSearch className="size-6 fill-current text-black/60 dark:text-white/40" />
					}
				/>
				{ScopeComponent}
				{!handleCheckboxChange && SortComponent}
			</div>
			<div className="flex justify-between h-10 xl:h-12 gap-4">
				<Skeleton
					isLoaded={!!data}
					className="flex items-center flex-1 rounded-2xl"
				>
					<h2
						suppressHydrationWarning
						className="text-black dark:text-white/80 text-lg leading-[1.125rem] flex items-center gap-2"
					>
						{countLabel ||
							t.rich("resourcesCount", {
								count: formatter.number(
									actuallyNoData ? 0 : data?.totalItems || 0
								),
								number: (chunks) => (
									<span
										suppressHydrationWarning
										className="text-2xl leading-6"
									>
										{chunks}
									</span>
								),
							})}
					</h2>
				</Skeleton>
				<div className="xl:w-72 flex gap-4">
					<Card className="h-full flex items-center justify-center flex-1">
						<div className="xl:px-3 px-1">
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
					<div className="hidden xl:flex gap-0 w-28">
						<Button
							color={view === "list" ? "tertiary" : "secondary"}
							isIconOnly
							className="!p-0 rounded-r-none flex-1"
							onClick={() => setView("list")}
						>
							<HiOutlineViewList className="size-6" />
						</Button>
						<Button
							color={view === "grid" ? "tertiary" : "secondary"}
							isIconOnly
							className="!p-0 rounded-l-none flex-1"
							onClick={() => setView("grid")}
						>
							<IoGrid className="size-4" />
						</Button>
					</div>
				</div>
			</div>
		</>
	);
}

function MainContent({
	searchParams,
}: {
	searchParams: { [key: string]: any };
}) {
	const { router, pathname, createQueryString } =
		useParamsState(searchParams);
	const { itemsCache } = useContext(CacheContext);

	const collectionsParam = searchParams["collections"];
	const collections = collectionsParam ? collectionsParam.split(",") : [];
	const pageNumber = Number(searchParams["page"]) || 1;
	const sort = searchParams["sort"] || SORT_OPTIONS[0].key;
	const search = searchParams["search"] || "";
	const scope = searchParams["scope"] || SCOPE_OPTIONS[0].key;
	const range = searchParams["range"] || "";

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

	const handleRangeChange = useCallback(
		(start: string | null, end: string | null) => {
			router.push(
				createQueryString(pathname, [
					["range", [start, end].join(end !== null ? "-" : "")],
				])
			);
		},
		[router, pathname, createQueryString]
	);

	const {
		data: fetchedItemsData,
		error: itemsError,
		isLoading: isItemsLoading,
	} = useSWR<ItemsGetResponse>(
		buildItemsQuery({
			pageNumber,
			sort,
			collections,
			search,
			scope,
			range,
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

	if (fetchedItemsData) {
		itemsCache.current = fetchedItemsData;
	}

	const itemsData = itemsCache.current;

	const {
		data: collectionsData,
		error: collectionsError,
		isLoading: isCollectionsLoading,
	} = useSWR<CollectionsGetResponse>("/collections", fetcher, {
		keepPreviousData: true,
	});

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
				range={range}
				handleRangeChange={handleRangeChange}
				facetDistribution={itemsData?.facetDistribution}
			/>
			<ResourcesView
				sort={sort}
				search={search}
				scope={scope}
				handleSearchChange={handleSearchChange}
				handleScopeChange={handleScopeChange}
				handleSortChange={handleSortChange}
				itemsData={itemsData}
				itemsError={itemsError}
				isItemsLoading={isItemsLoading}
				selectedCollections={selectedCollections}
				handleCheckboxChange={handleCheckboxChange}
				collectionsData={collectionsData}
				hierarchy={hierarchy}
				range={range}
				handleRangeChange={handleRangeChange}
				pageNumber={pageNumber}
				handlePageChange={handlePageChange}
			/>
		</>
	);
}

export default function EvidenceLibrary({
	searchParams,
}: {
	searchParams: { [key: string]: any };
}) {
	return (
		<main className="w-full max-w-screen-2xl px-4 xl:px-14">
			<div className="flex gap-[40px] flex-col xl:flex-row">
				<MainContent searchParams={searchParams} />
			</div>
		</main>
	);
}
