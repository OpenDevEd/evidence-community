"use client";

import {
	Accordion,
	AccordionItem,
	AutocompleteItem,
	AutocompleteSection,
	Listbox,
	ListboxItem,
} from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { Skeleton } from "../../nextui/Skeleton";
import CollectionCategory from "./CollectionCategory";
import {
	Collection,
	CollectionsGetResponse,
} from "@/app/api/collections/types";
import { Autocomplete } from "../../nextui/Autocomplete";
import { Switch } from "../../nextui/Switch";
import { Fragment, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Input } from "../../nextui/Input";
import { useDebounce } from "@/hooks/useDebounce";
import { COUNTRIES, COUNTRY_PARAMS, CUSTOM_FILTER_INSTITUTION, IS_COUNTRY_LIBRARY, years } from "@/constants/misc";
import { INSTITUTION_LOGOS } from "@/constants/items";
import { FacetDistribution } from "meilisearch";
import { LuCheck, LuChevronDown, LuChevronRight, LuX } from "react-icons/lu";
import { IoFilter } from "react-icons/io5";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { CacheContext, useFeatureFlagEnabled } from "@/context/Providers";
import { searchParamsLoader } from "@/lib/searchParams";
import { inferParserType } from "nuqs";
import {
	FacetListItem,
	useFacetList,
	useFacetListRaw,
	useMultipleFacetLists,
} from "@/hooks/useFacetList";
import Image from "next/image";
import { fetcher, fold, getCountryAncestry, getCountryInfo } from "@/lib/utils";
import { BsList } from "react-icons/bs";
import { Button } from "../../nextui/Button";
import { InstitutionsData } from "@/app/api/institutions/types";
function YearPicker({
	label,
	selectedKey,
	onSelectionChange,
}: {
	label?: string;
	selectedKey: string | null;
	onSelectionChange: (value: any | null) => void;
}) {
	const [debouncedOnSelectionChange, _] = useDebounce(onSelectionChange, 500);

	const isYearsDropDownEnabled = useFeatureFlagEnabled("years-dropdown");

	if (isYearsDropDownEnabled) {
		return (
			<Autocomplete
				className="flex-1"
				label={label}
				key={label}
				fullWidth={true}
				selectedKey={selectedKey}
				onSelectionChange={onSelectionChange}
				inputProps={{
					classNames: {
						inputWrapper:
							"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
						input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
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
			defaultValue={selectedKey || ""}
			onChange={(e) => debouncedOnSelectionChange(e.target.value)}
			classNames={{
				inputWrapper:
					"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
				input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
				label: "text-black/80 dark:text-white/80",
			}}
		/>
	);
}

const UNCATEGORIZED_SECTION = "Uncategorized";

function FacetPicker({
	label,
	placeholder,
	selectedKey,
	onSelectionChange,
	list,
	facetDistribution,
	facetName,
	searchList,
}: {
	label: string;
	placeholder: string;
	selectedKey: string | null | string[];
	list: FacetListItem[];
	onSelectionChange?: (value: any | null) => void;
	facetDistribution?: FacetDistribution | undefined;
	facetName?: string;
	searchList?: FacetListItem[];
}) {
	const isMultiSelect = Array.isArray(selectedKey);
	const [search, setSearch] = useState("");
	const locale = useLocale();
	const countryNames = new Intl.DisplayNames([locale === "cn" ? "zh" : locale], { type: "region" });
	// Labels are English: a country also matches by its name in the page's language.
	const matchesSearch = (item: FacetListItem) => {
		const code = item.key.split(" > ").pop() ?? "";
		const localName = item.section === "Countries" && code.length === 2 ? countryNames.of(code) ?? "" : "";
		return [item.label, localName].some((name) => fold(name).includes(fold(search.trim())));
	};
	const displayedList =
		search.length > 0 && searchList ? searchList.filter(matchesSearch) : list;

	const groupedBySection = displayedList.reduce((acc, item) => {
		if (!acc[item.section || UNCATEGORIZED_SECTION]) {
			acc[item.section || UNCATEGORIZED_SECTION] = [];
		}
		acc[item.section || UNCATEGORIZED_SECTION].push(item);
		return acc;
	}, {} as Record<string, FacetListItem[]>);

	const allSectionNames = Object.keys(groupedBySection);

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
					scrollShadowProps={{
						isEnabled: false,
						size: 0,
					}}
					selectedKey={isMultiSelect ? null : selectedKey}
					onSelectionChange={(key) => {
						const item = displayedList!.find(
							(item) => item.key === key
						);
						const functionToCall =
							item?.onSelectionChange || onSelectionChange;
						if (functionToCall) {
							if (item?.query) {
								functionToCall(item.query);
							} else {
								functionToCall(key);
							}
						}
					}}
					inputProps={{
						classNames: {
							inputWrapper:
								"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
							input: twMerge(
								"placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
								isMultiSelect &&
									selectedKey.length > 0 &&
									"placeholder:text-black dark:placeholder:text-white"
							),
						},
					}}
					defaultFilter={(textValue, inputValue) => {
						return true;
					}}
					onInputChange={(string) => setSearch(string)}
					isVirtualized={true}
					disabledKeys={allSectionNames.map(
						(name) => `section-${name}`
					)}
					// startContent={
					// 	isMultiSelect && selectedKey.length > 0 ? (
					// 		<div className="flex gap-2 has-[div]:mr-0 has-[div]:ml-0 ltr:-ml-1 rtl:-mr-1">
					// 			{selectedKey
					// 				.map((key) => {
					// 					const startContent = list.find(
					// 						(item) => item.key === key
					// 					)?.startContent;
					// 					if (!startContent) return null;
					// 					return (
					// 						<div className="" key={key}>
					// 							{startContent}
					// 						</div>
					// 					);
					// 				})
					// 				.filter((item) => item !== null)}
					// 		</div>
					// 	) : (
					// 		list.find((item) => item.key === selectedKey)
					// 			?.startContent
					// 	)
					// }
					itemHeight={48}
				>
					{Object.entries(groupedBySection).map(
						([section, items]) => (
							<Fragment key={`section-group-${section}`}>
								{allSectionNames.length > 1 && (
									<AutocompleteItem
										startContent={
											<BsList className="size-8" />
										}
										key={`section-${section}`}
										className="opacity-100"
										description={`${items.length} items`}
										isReadOnly
									>
										{section}
									</AutocompleteItem>
								)}
								{items
									.map((itemAny: any) => {
										const item = itemAny as FacetListItem;
										if (item.hide) return null;
										return (
											<AutocompleteItem
												startContent={item.startContent}
												aria-label={item.label}
												key={item.key}
												style={item.style}
												selectedIcon={
													isMultiSelect &&
													(item.isSelected !==
													undefined
														? item.isSelected
														: selectedKey.includes(
																item.key
														  )) ? (
														<LuCheck />
													) : undefined
												}
											>
												<span className="text-black dark:text-white line-clamp-2 flex items-center gap-2">
													<span
														className={twMerge(
															"text-black/60 dark:text-white/60",
															item.hideCount &&
																"hidden"
														)}
													>
														{`(${
															item.count !==
															undefined
																? item.count
																: facetDistribution &&
																  facetName
																? facetDistribution?.[
																		facetName!
																  ]?.[
																		item.key
																  ] || 0
																: "0"
														})`}
													</span>
													{item.label}
													{item.showArrow && (
														<LuChevronDown />
													)}
												</span>
											</AutocompleteItem>
										);
									})
									.filter((item) => item !== null)}
							</Fragment>
						)
					)}
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
	const defaultExpanded = !process.env.NEXT_PUBLIC_DEFAULT_EXPANDED_COLLECTIONS || process.env.NEXT_PUBLIC_DEFAULT_EXPANDED_COLLECTIONS === "true";
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
					: defaultExpanded ? hierarchy.map((c) => c.key) : []
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

function CountryParser(
	queryParams: inferParserType<typeof searchParamsLoader>,
	countryCanditate: string,
	appendPath: boolean = false,
	queryParam?: keyof inferParserType<typeof searchParamsLoader>,
	onSelectionChange?: (value: any | null) => void
): FacetListItem | null {
	const country = appendPath
		? COUNTRY_PARAMS[countryCanditate]
		: countryCanditate;

	if (!country) {
		return null;
	}

	const { countryName, label, numberOfParts, countryCode } =
		getCountryInfo(country);
	const ancestry = getCountryAncestry(country);
	const queryParamValue = queryParams[queryParam || "country"];
	const parent = ancestry[ancestry.length - 2];
	const isSelected =
		queryParamValue && Array.isArray(queryParamValue)
			? queryParamValue.includes(country)
			: false;
	const isParentSelected =
		parent && queryParamValue && Array.isArray(queryParamValue)
			? queryParamValue.includes(parent)
			: true;

	return {
		key: country,
		countKey: countryCanditate,
		label,
		startContent: countryName && (
			<div className="flex size-5 aspect-square justify-center items-center gap-2">
				<Image
					src={`https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`}
					alt={countryCode}
					width={20}
					height={20}
					className="size-full object-contain"
					objectFit="contain"
				/>
			</div>
		),
		style: {
			paddingLeft: `${numberOfParts * 1.5 + 0.5}rem`,
		},
		hideCount:
			ancestry.length <= 2
				? true
				: queryParamValue && Array.isArray(queryParamValue)
				? queryParamValue.includes(country)
				: false,
		hide: !isParentSelected,
		query: ancestry,
		onSelectionChange,
		section: "Countries",
		isSelected,
	};
}

function InstitutionParser(
	institution: string,
	queryParams: inferParserType<typeof searchParamsLoader>,
	onSelectionChange?: (value: any | null) => void
): FacetListItem {
	const isSelected = queryParams.institution.includes(institution);

	return {
		key: institution,
		label: institution,
		onSelectionChange,
		section: "Institutions",
		isSelected,
	};
}

function FiltersList({
	queryParams,
	handleCountrySelect,
	handleAuthorCountrySelect,
	handleInstitutionSelect,
	facetDistribution,
}: {
	queryParams: inferParserType<typeof searchParamsLoader>;
	handleCountrySelect: (country: string) => void;
	handleAuthorCountrySelect: (country: string) => void;
	handleInstitutionSelect: (institution: string) => void;
	facetDistribution: FacetDistribution | undefined;
}) {
	const isCountryFocusEnabled = useFeatureFlagEnabled("country-focus");
	const isAuthorLocationEnabled = useFeatureFlagEnabled("author-location");
	const isNationalityFocusEnabled = IS_COUNTRY_LIBRARY;

	const { data: nationalInstitutionsData } = useSWR<InstitutionsData>(
		isNationalityFocusEnabled ? `/institutions` : null,
		fetcher
	)

	const { globalExpanded, setGlobalExpanded } = useContext(CacheContext);

	const enabledCount = [
		isCountryFocusEnabled,
		isAuthorLocationEnabled,
	].filter(Boolean).length;

	const t = useTranslations("ui");

	const [institutions, institutionsFacetDistribution] = useFacetList(
		facetDistribution!,
		"institution",
		(institution) =>
			InstitutionParser(institution, queryParams, handleInstitutionSelect)
	);

	const [countries] = useFacetList(
		facetDistribution!,
		"country",
		(country) =>
			CountryParser(
				queryParams,
				country,
				false,
				"country",
				handleCountrySelect
			),
		(a, b) => a.localeCompare(b)
	);
	const [countries_uncategorized] = useFacetList(
		facetDistribution!,
		"country_uncategorized",
		(country) =>
			CountryParser(
				queryParams,
				country,
				true,
				"country",
				handleCountrySelect
			),
		(a, b) => a.localeCompare(b)
	);

	const [author_countries] = useMultipleFacetLists(
		useFacetList(
			facetDistribution!,
			"creators.institutions.country_code",
			(country) =>
				CountryParser(
					queryParams,
					country,
					false,
					"author_country",
					handleAuthorCountrySelect
				),
			(a, b) => a.localeCompare(b)
		),
		[institutions, institutionsFacetDistribution]
	);
	const [author_countries_uncategorized] = useMultipleFacetLists(
		useFacetList(
			facetDistribution!,
			"creators.institutions.country_code_uncategorized",
			(country) =>
				CountryParser(
					queryParams,
					country,
					true,
					"author_country",
					handleAuthorCountrySelect
				),
			(a, b) => a.localeCompare(b)
		),
		[institutions, institutionsFacetDistribution]
	);

	const nationalInstitutions = useMemo(() => {
		return institutions.filter((item) => nationalInstitutionsData?.institutions.some((institution) => institution.institution === item.key));
	}, [institutions, nationalInstitutionsData]);

	const countryFocusFilter = useMemo(() => {
		return (
			isCountryFocusEnabled && (
				<FacetPicker
					key={"country-focus-filter"}
					label={t("countryFilter")}
					placeholder={t("countryFilterDescription")}
					selectedKey={queryParams.country}
					onSelectionChange={handleCountrySelect}
					facetDistribution={facetDistribution}
					list={countries}
					facetName="country"
					searchList={countries_uncategorized.map((item) => ({
						...item,
						hide: false,
					}))}
				/>
			)
		);
	}, [
		isCountryFocusEnabled,
		t,
		queryParams.country,
		handleCountrySelect,
		facetDistribution,
		countries,
		countries_uncategorized,
	]);

	const nationalInstitutionsFilter = useMemo(() => {
		return (
			isNationalityFocusEnabled && (
			<FacetPicker
				key={"national-institutions-filter"}
				label={t("nationalInstitutions")}
				placeholder={t("nationalInstitutionsDescription", {
					country: nationalInstitutionsData?.topCountryCode ? COUNTRIES[nationalInstitutionsData.topCountryCode] : "",
				})}
				selectedKey={queryParams.institution}
				onSelectionChange={handleInstitutionSelect}
				facetDistribution={facetDistribution}
				list={nationalInstitutions}
				facetName="institution"
				searchList={nationalInstitutions.map((item) => ({
					...item,
					hide: false,
				}))}
			/>
		))
	}, [
		isNationalityFocusEnabled,
		t,
		queryParams.institution,
		handleInstitutionSelect,
		facetDistribution,
		nationalInstitutionsData,
		institutions,
	]);

	const authorLocationFilter = useMemo(() => {
		return (
			isAuthorLocationEnabled && (
				<FacetPicker
					key={"author-location-filter"}
					label={
						author_countries.find(
							(item) => item.section === "Countries"
						)?.label
							? IS_COUNTRY_LIBRARY ? t("coauthorCountries") : t("authorCountries")
							: t("institutions")
					}
					placeholder={
						author_countries.find(
							(item) => item.section === "Countries"
						)?.label
							? t("authorCountriesDescription")
							: t("authorInstitutionsDescription")
					}
					selectedKey={[
						...queryParams.author_country,
						...queryParams.institution,
					]}
					list={author_countries}
					searchList={author_countries_uncategorized.map((item) => ({
						...item,
						hide: false,
					}))}
				/>
			)
		);
	}, [
		isAuthorLocationEnabled,
		t,
		author_countries,
		queryParams.author_country,
		queryParams.institution,
		author_countries_uncategorized,
	]);

	const moreFilters = useMemo(() => {
		return (
			<>
				{countryFocusFilter}
				{nationalInstitutionsFilter}
				{authorLocationFilter}
			</>
		);
	}, [countryFocusFilter, nationalInstitutionsFilter, authorLocationFilter]);

	const isMoreFiltersOpen = globalExpanded["more-filters"] ?? true;
	const setIsMoreFiltersOpen = (value: boolean) => {
		setGlobalExpanded((prev: Record<string, boolean>) => ({
			...prev,
			["more-filters"]: value,
		}));
	};

	return enabledCount > 1 ? (
		<>
			<div className="flex flex-col" role="region" aria-label={t("moreFilters")}>
				<div className="flex justify-between items-center gap-4 pt-4">
					<h4 className="text-lg font-medium text-black/80 dark:text-white/80 flex" id="more-filters-heading">
						{t("moreFilters")}
					</h4>
					<Button
						isIconOnly
						variant="light"
						size="sm"
						radius="full"
						className={twMerge(
							"text-black/80 dark:text-white/80",
							isMoreFiltersOpen && "rotate-180"
						)}
						onClick={() => setIsMoreFiltersOpen(!isMoreFiltersOpen)}
						aria-expanded={isMoreFiltersOpen}
						aria-controls="more-filters-content"
						aria-labelledby="more-filters-heading"
					>
						<LuChevronDown aria-hidden="true" />
						<span className="sr-only">
							{isMoreFiltersOpen ? t("collapseFilters") : t("expandFilters")}
						</span>
					</Button>
				</div>
				<AnimatePresence initial={false}>
					{isMoreFiltersOpen && (
						<motion.div
							initial={{ height: 0 }}
							animate={{ height: "auto" }}
							exit={{ height: 0 }}
							className="flex flex-col gap-4 overflow-hidden"
							id="more-filters-content"
							role="region"
							aria-labelledby="more-filters-heading"
						>
							<div className="flex flex-col gap-4 pt-4">
								{moreFilters}
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
			{/* <Accordion defaultExpandedKeys={["More Filters"]} className="p-0">
				<AccordionItem
					key={"More Filters"}
					title={t("moreFilters")}
					classNames={{
						content: "p-0 flex flex-col gap-4 pt-4",
						trigger: "pb-0 pt-2",
					}}
				>
					{moreFilters}
				</AccordionItem>
			</Accordion> */}
		</>
	) : (
		moreFilters
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
	handleAuthorCountrySelect,
	isModal = false,
	queryParams,
}: {
	data: CollectionsGetResponse | undefined;
	facetDistribution: FacetDistribution | undefined;
	handleCheckboxChange: (key: string) => void;
	handleCountrySelect: (country: string) => void;
	handleAuthorCountrySelect: (country: string) => void;
	selectedCollections: string[];
	isModal?: boolean;
	range: string;
	handleRangeChange: (start: string | null, end: string | null) => void;
	handleInstitutionSelect: (institution: string) => void;
	hierarchy: Collection[];
	queryParams: inferParserType<typeof searchParamsLoader>;
}) {
	const t = useTranslations("ui");
	const isCollectionsEnabled = useFeatureFlagEnabled("collections");
	const customFilterInstitution = CUSTOM_FILTER_INSTITUTION;

	const [start, end, sameYear] = useMemo(() => {
		const dashExists = range.includes("-");
		const [start, end] = range.split("-");
		const startNumber = start || "";
		const endNumber = end || "";
		return [startNumber, endNumber, !dashExists];
	}, [range]);

	const customFilter = useMemo(() => {
		if (!customFilterInstitution) return null;
		const isCustomFilterInstitutionSelected = queryParams.institution.includes(customFilterInstitution || "");
		return (
			<Button
				color={isCustomFilterInstitutionSelected ? "tertiary" : "secondary"}
				variant={isCustomFilterInstitutionSelected ? "solid" : "flat"}
				onPress={() => handleInstitutionSelect(customFilterInstitution)}
				className="w-full min-w-0 flex justify-start mb-4"
				startContent={
					INSTITUTION_LOGOS[customFilterInstitution]({
						className: "h-6 shrink-0",
					})
				}
				endContent={<IoFilter className="size-5 ml-auto shrink-0" />}
				title={`${t("filterBy")} ${customFilterInstitution}`}
			>
				{/* Long institution names truncate instead of pushing the
				    icons out of the button. */}
				<span className="min-w-0 flex-1 truncate text-left">
					{t("filterBy")} {customFilterInstitution}
				</span>
			</Button>
		);
	}, [queryParams.institution, handleInstitutionSelect, t]);

	return (
		<aside
			id="collections"
			aria-label={t("filtersAndCollectionsAriaLabel")}
			className={twMerge(
				"w-full shrink-0 z-20",
				isModal
					? "block"
					: "hidden lg:block lg:w-[24rem] xl:w-[28.5rem]"
			)}
		>
			<Skeleton
				data-collections={isCollectionsEnabled}
				className="w-full data-[collections=true]:lg:min-h-screen rounded-2xl"
				isLoaded={!!data && !!facetDistribution}
			>
				{customFilter && (
					<div className={twMerge("w-full", isModal && "px-6")}>
						{customFilter}
					</div>
				)}
				<section className="w-full bg-[#E8E6E1] dark:bg-secondary sm:rounded-t-2xl last:rounded-b-2xl flex flex-col gap-2 p-6 sticky top-0 lg:static z-20">
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
						{/* No `layout` on these: it made them animate on mount
						    whenever the sidebar's size settled around them.
						    popLayout alone handles the swap. */}
						<AnimatePresence mode="popLayout" initial={false}>
							{sameYear ? (
								<motion.div
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: 10 }}
									transition={{ duration: 0.2, ease: "easeOut" }}
									key="same-year"
									className="w-full"
								>
								<YearPicker
									label={t("year")}
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
									transition={{ duration: 0.2, ease: "easeOut" }}
									key="year-range"
									className="flex gap-4 w-full"
								>
								{[
									{
										label: t("from"),
									},
									{
										label: t("to"),
									},
								].map(({ label }, index) => (
									<YearPicker
										key={label}
										label={label}
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
					<FiltersList
						queryParams={queryParams}
						handleCountrySelect={handleCountrySelect}
						handleAuthorCountrySelect={handleAuthorCountrySelect}
						handleInstitutionSelect={handleInstitutionSelect}
						facetDistribution={facetDistribution}
					/>
				</section>
				{isCollectionsEnabled && (
					<section className="w-full">
						{/* <div className="p-4 pt-6 pb-0 bg-white dark:bg-card">
						<Input
							placeholder={t("searchCollections")}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div> */}

						<InnerCollectionList
							data={data}
							facetDistribution={facetDistribution}
							handleCheckboxChange={handleCheckboxChange}
							handleCountrySelect={handleCountrySelect}
							selectedCollections={selectedCollections}
							hierarchy={hierarchy}
						/>
					</section>
				)}
			</Skeleton>
		</aside>
	);
}
