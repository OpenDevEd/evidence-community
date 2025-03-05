"use client";

import { Accordion, AccordionItem, AutocompleteItem } from "@nextui-org/react";
import { Skeleton } from "../../nextui/Skeleton";
import { twMerge } from "tailwind-merge";
import CollectionCategory from "./CollectionCategory";
import {
	Collection,
	CollectionsGetResponse,
} from "@/app/api/collections/types";
import { Autocomplete } from "../../nextui/Autocomplete";
import { Switch } from "../../nextui/Switch";
import { use, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Input } from "../../nextui/Input";
import { useDebounce } from "@/hooks/useDebounce";
import { COUNTRIES, years } from "@/constants/misc";
import { FacetDistribution } from "meilisearch";
import { LuFilter, LuX } from "react-icons/lu";
import { useTranslations } from "next-intl";
import { CacheContext, useFeatureFlagEnabled } from "@/context/Providers";
import useBreakpoint from "@/hooks/useBreakpoint";
import { ItemsContext } from "../items/ItemsList";
import { searchParamsLoader } from "@/lib/searchParams";
import { inferParserType } from "nuqs";
import { FacetListItem, useFacetList } from "@/hooks/useFacetList";
import Image from "next/image";

function YearPicker({
	label,
	placeholder,
	selectedKey,
	onSelectionChange,
}: {
	label?: string;
	placeholder: string;
	selectedKey: string | null;
	onSelectionChange: (value: any | null) => void;
}) {
	const [debouncedOnSelectionChange, _] = useDebounce(onSelectionChange, 500);

	const isYearsDropDownEnabled = useFeatureFlagEnabled("years-dropdown");

	if (isYearsDropDownEnabled) {
		return (
			<Autocomplete
				className="flex-1"
				placeholder={placeholder}
				label={label}
				key={label}
				fullWidth={true}
				selectedKey={selectedKey}
				onSelectionChange={onSelectionChange}
				inputProps={{
					classNames: {
						inputWrapper:
							"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
						input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base xl:text-small",
					},
				}}
				isVirtualized={true}
			>
				{years.map((year) => (
					<AutocompleteItem aria-label={year} key={year}>
						{year}
					</AutocompleteItem>
				))}
			</Autocomplete>
		);
	}

	return (
		<Input
			type="number"
			label={label}
			placeholder={placeholder}
			defaultValue={selectedKey || ""}
			onChange={(e) => debouncedOnSelectionChange(e.target.value)}
		/>
	);
}

function FacetPicker({
	label,
	placeholder,
	selectedKey,
	onSelectionChange,
	list,
	facetDistribution,
	facetName,
}: {
	label: string;
	placeholder: string;
	selectedKey: string | null;
	onSelectionChange: (value: any | null) => void;
	list: FacetListItem[];
	facetDistribution: FacetDistribution | undefined;
	facetName: string;
}) {
	return (
		<div className="w-full flex flex-col gap-2">
			{/* <div className="text-lg font-medium text-black/80 dark:text-white/80 flex">
				<span>{label}</span>
			</div> */}
			<div className="text-lg font-medium text-black/80 dark:text-white/80 flex">
				<Autocomplete
					className="flex-1"
					placeholder={placeholder}
					label={label}
					key={label}
					fullWidth={true}
					selectedKey={selectedKey}
					onSelectionChange={onSelectionChange}
					inputProps={{
						classNames: {
							inputWrapper:
								"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
							input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base xl:text-small",
						},
					}}
					isVirtualized={true}
					startContent={
						list.length > 0 ? (
							list.find((item) => item.key === selectedKey)
								?.startContent
						) : (
							undefined
						)
					}
					itemHeight={48}
				>
					{list.map((item) => (
						<AutocompleteItem
							startContent={item.startContent}
							aria-label={item.label}
							key={item.key}
						>
							<span className="text-black dark:text-white line-clamp-2">
								<span className="text-black/60 dark:text-white/60">
									(
									{facetDistribution?.[facetName]?.[
										item.key
									] || 0}
									){" "}
								</span>
								{item.label}
							</span>
						</AutocompleteItem>
					))}
				</Autocomplete>
			</div>
		</div>
	);
}

export function InnerCollectionList({
	data,
	facetDistribution,
	handleCheckboxChange,
	handleCountrySelect,
	selectedCollections,
	hierarchy,
}: {
	data: CollectionsGetResponse | undefined;
	facetDistribution: FacetDistribution | undefined;
	handleCheckboxChange: (key: string) => void;
	handleCountrySelect: (country: string) => void;
	selectedCollections: string[];
	hierarchy: Collection[];
}) {
	const { accordionGlobalExpanded, setAccordionGlobalExpanded } =
		useContext(CacheContext);

	const t = useTranslations("ui");
	const filteredFacetDistribution = useMemo(() => {
		if (!facetDistribution?.collectionsAncestry || !data?.collections) {
			return { collectionsAncestry: {} };
		}

		return {
			collectionsAncestry: Object.fromEntries(
				Object.entries(facetDistribution.collectionsAncestry).filter(
					([key]) => data.collections.some((c) => c.key === key)
				)
			),
		};
	}, [facetDistribution, data]);

	const displayedCollections = useMemo(() => {
		return hierarchy.filter(
			(collection) =>
				data?.collections.filter(
					(c) =>
						c.originalFacet === collection.key &&
						filteredFacetDistribution.collectionsAncestry[c.key]
				).length
		);
	}, [hierarchy, data, filteredFacetDistribution]);

	return hierarchy &&
		hierarchy.length > 0 &&
		facetDistribution &&
		Object.keys(facetDistribution.collectionsAncestry || {}).filter((key) =>
			data?.collections.find((c) => c.key === key)
		).length > 0 ? (
		<Accordion
			defaultSelectedKeys={
				accordionGlobalExpanded
					? Object.keys(accordionGlobalExpanded)
					: hierarchy.map((c) => c.key)
			}
			onSelectionChange={(keys) => {
				setAccordionGlobalExpanded(
					Array.from(keys as Set<string>).reduce(
						(acc: Record<string, boolean>, key: string) => ({
							...acc,
							[key]: !acc[key],
						}),
						{} as Record<string, boolean>
					)
				);
			}}
			selectionMode="multiple"
			fullWidth={false}
			variant="shadow"
			className="bg-white dark:bg-card p-6 rounded-xl rounded-t-none shadow-none"
			itemClasses={{
				title: "text-black/80 dark:text-white/80 font-base text-2xl",
				indicator: "text-black/80 dark:text-white/80",
				trigger: "p-0",
				base: "mb-4 last:mb-0",
				content: "py-0 pt-2",
			}}
			showDivider={false}
		>
			{displayedCollections.map((collection) => (
				<AccordionItem
					key={collection.key}
					title={collection.title || collection.name}
				>
					<CollectionCategory
						collection={collection}
						hierarchy={hierarchy}
						selectedCollections={selectedCollections}
						handleCheckboxChange={handleCheckboxChange}
						facetDistribution={filteredFacetDistribution}
					/>
				</AccordionItem>
			))}
		</Accordion>
	) : (
		<div className="text-lg bg-white dark:bg-card p-6 rounded-xl shadow-none text-black/80 dark:text-white/80 font-medium flex justify-center items-center gap-2 select-none">
			<LuX className="stroke-current size-6" />
			<span>{t("noFacetsFound")}</span>
		</div>
	);
}

export default function CollectionsList({
	data,
	facetDistribution,
	handleCheckboxChange,
	selectedCollections,
	hierarchy,
	range,
	handleRangeChange,
	handleInstitutionSelect,
	handleCountrySelect,
	isModal = false,
	queryParams,
}: {
	data: CollectionsGetResponse | undefined;
	facetDistribution: FacetDistribution | undefined;
	handleCheckboxChange: (key: string) => void;
	handleCountrySelect: (country: string) => void;
	selectedCollections: string[];
	isModal?: boolean;
	range: string;
	handleRangeChange: (start: string | null, end: string | null) => void;
	handleInstitutionSelect: (institution: string) => void;
	hierarchy: Collection[];
	queryParams: inferParserType<typeof searchParamsLoader>;
}) {
	const [search, setSearch] = useState("");
	const t = useTranslations("ui");
	const isCollectionsEnabled = useFeatureFlagEnabled("collections");
	const isCountryEnabled = process.env.NEXT_PUBLIC_DISABLE_COUNTRY !== "true";
	const isFiltersEnabled = isCollectionsEnabled || isCountryEnabled;
	const isInstitutionFilterEnabled =
		useFeatureFlagEnabled("institution-filter");
	const institutions = useFacetList(facetDistribution!, "institution");
	const countries = useFacetList(
		facetDistribution!,
		"country",
		(country) => ({
			key: country,
			label: `${COUNTRIES[country]} (${country})`,
			startContent: (
				<div className="flex size-5 aspect-square justify-center items-center gap-2">
					<Image
						src={`https://flagcdn.com/w40/${country.toLowerCase()}.png`}
						alt={country}
						width={20}
						height={20}
						className="size-full object-contain"
						objectFit="contain"
					/>
				</div>
			),
		})
	);

	const [start, end, sameYear] = useMemo(() => {
		const dashExists = range.includes("-");
		const [start, end] = range.split("-");
		const startNumber = start || "";
		const endNumber = end || "";
		return [startNumber, endNumber, !dashExists];
	}, [range]);

	return (
		<aside
			id="collections"
			aria-label={t("filtersAndCollectionsAriaLabel")}
			className={twMerge(
				"w-full shrink-0 z-20",
				isModal ? "block" : "hidden xl:block xl:w-[28.5rem]"
			)}
		>
			<Skeleton
				data-collections={isCollectionsEnabled}
				className="w-full data-[collections=true]:xl:min-h-screen rounded-2xl"
				isLoaded={!!data && !!facetDistribution}
			>
				<section className="w-full bg-black/[4%] dark:bg-secondary sm:rounded-t-2xl last:rounded-b-2xl flex flex-col gap-2 p-6 sticky top-0 xl:static z-20">
					<div className="text-lg font-medium text-black/80 dark:text-white/80 flex">
						<span>{t("publicationYear")}</span>
						<div className="flex gap-4 items-center flex-1 justify-end">
							<Switch
								isSelected={!sameYear}
								onValueChange={(value) =>
									handleRangeChange(
										start,
										sameYear ? end : null
									)
								}
								classNames={{
									label: "text-sm font-normal",
								}}
							>
								{t("yearRange")}
							</Switch>
						</div>
					</div>
					<div className="">
						<AnimatePresence mode="popLayout" initial={false}>
							{sameYear ? (
								<motion.div
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: 10 }}
									key="same-year"
									layout
									className="w-full"
								>
									<YearPicker
										label={t("year")}
										placeholder={t("year")}
										selectedKey={start}
										onSelectionChange={(key) =>
											handleRangeChange(key, null)
										}
									/>
								</motion.div>
							) : (
								<motion.div
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: 10 }}
									key="year-range"
									layout
									className="flex gap-4 w-full"
								>
									{[
										{
											label: t("from"),
											placeholder: t("year"),
										},
										{
											label: t("to"),
											placeholder: t("year"),
										},
									].map(({ label, placeholder }, index) => (
										<YearPicker
											key={label}
											label={label}
											placeholder={placeholder}
											selectedKey={
												index === 0 ? start : end
											}
											onSelectionChange={(key) =>
												handleRangeChange(
													index === 0
														? key || ""
														: start,
													index === 1
														? key || ""
														: end
												)
											}
										/>
									))}
								</motion.div>
							)}
						</AnimatePresence>
					</div>
					{isFiltersEnabled && <Accordion
						defaultExpandedKeys={["More Filters"]}
						className="p-0"
					>
						<AccordionItem
							key={"More Filters"}
							title={t("moreFilters")}
							classNames={{
								content: "p-0 flex flex-col gap-2 pt-2",
								trigger: "pb-0 pt-2",
							}}
						>
							{isInstitutionFilterEnabled && (
								<>
									<FacetPicker
										label={t("institution")}
										placeholder={t("institution")}
										selectedKey={queryParams.institution}
										onSelectionChange={
											handleInstitutionSelect
										}
										facetDistribution={facetDistribution}
										list={institutions}
										facetName="institution"
									/>
								</>
							)}
							{isCountryEnabled && (
								<FacetPicker
									label={t("countryFilter")}
									placeholder={t("countryFilter")}
									selectedKey={queryParams.country}
									onSelectionChange={handleCountrySelect}
									facetDistribution={facetDistribution}
									list={countries}
									facetName="country"
								/>
							)}
						</AccordionItem>
					</Accordion>}
				</section>
				<section className="w-full">
					{/* <div className="p-4 pt-6 pb-0 bg-white dark:bg-card">
						<Input
							placeholder={t("searchCollections")}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div> */}
					{isCollectionsEnabled && (
						<InnerCollectionList
							data={data}
							facetDistribution={facetDistribution}
							handleCheckboxChange={handleCheckboxChange}
							handleCountrySelect={handleCountrySelect}
							selectedCollections={selectedCollections}
							hierarchy={hierarchy}
						/>
					)}
				</section>
			</Skeleton>
		</aside>
	);
}
