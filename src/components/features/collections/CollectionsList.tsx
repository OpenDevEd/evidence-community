"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	ArrowDown01Icon,
	Cancel01Icon,
	FilterIcon,
	ListViewIcon,
} from "@hugeicons/core-free-icons";
import {
	Accordion,
	AccordionItem,
	AutocompleteItem,
	AutocompleteSection,
	Listbox,
	ListboxItem,
} from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";
import { Skeleton } from "../../nextui/Skeleton";
import CollectionCategory from "./CollectionCategory";
import {
	Collection,
	CollectionsGetResponse,
} from "@/app/api/collections/types";
import { Autocomplete } from "../../nextui/Autocomplete";
import { createContext, Fragment, type ReactNode, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";
import { FacetDistribution } from "meilisearch";
import { useFormatter, useTranslations } from "next-intl";
import { CacheContext } from "@/context/Providers";
import { searchParamsLoader } from "@/lib/searchParams";
import { inferParserType } from "nuqs";
import {
	FacetListItem,
	useFacetList,
	useFacetListRaw,
} from "@/hooks/useFacetList";
import Image from "next/image";
import {
	getCountryAncestry,
	getCountryInfo,
	localizeOrUseIfCapitalized,
} from "@/lib/utils";
import { Button } from "../../nextui/Button";
import { InstitutionLogo } from "@/components/library/LibraryIdentity";
import {
	findInstitutionWithLogo,
	INSTITUTION_FILTER_FIELD,
} from "@/config/library-config/institutions";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { YearFilter } from "./YearFilter";
import { useTopicTree } from "@/lib/topics/client";
import type { TopicTreeNode } from "@/lib/topics/contract";
import { topicAncestry, toggleTopicSelection } from "@/lib/topics/selection";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { useFiltersContext } from "@/context/FiltersProvider";
import { ResultsOverview, shareOf, SIDEBAR_GREY, useFacetTotal } from "./ResultsOverview";
import { FacetOption, ShareRing } from "./FacetOption";

const UNCATEGORIZED_SECTION = "Uncategorized";

function searchedFacetItems(
	list: FacetListItem[],
	searchList: FacetListItem[] | undefined,
	search: string,
) {
	if (search.length === 0) return list;
	return (searchList ?? list).filter((item) =>
		item.label.toLowerCase().includes(search.toLowerCase()),
	);
}

/** An option with its figures at a glance: its count and share of the results, and a bar against the largest option. */
function FacetPicker({
	label,
	placeholder,
	selectedKey,
	onSelectionChange,
	list,
	facetDistribution,
	facetName,
	searchList,
	fixedHeight = false,
	total,
}: {
	label: string;
	placeholder: string;
	selectedKey: string | null | string[];
	list: FacetListItem[];
	onSelectionChange?: (value: any | null) => void;
	facetDistribution?: FacetDistribution | undefined;
	facetName?: string;
	searchList?: FacetListItem[];
	fixedHeight?: boolean;
	/** How many results there are, for each option's share of them. */
	total?: number;
}) {
	const format = useFormatter();
	const isMultiSelect = Array.isArray(selectedKey);
	const [search, setSearch] = useState("");
	const displayedList = searchedFacetItems(list, searchList, search);

	const groupedBySection = displayedList.reduce(
		(acc, item) => {
			if (!acc[item.section || UNCATEGORIZED_SECTION]) {
				acc[item.section || UNCATEGORIZED_SECTION] = [];
			}
			acc[item.section || UNCATEGORIZED_SECTION].push(item);
			return acc;
		},
		{} as Record<string, FacetListItem[]>,
	);

	const allSectionNames = Object.keys(groupedBySection);
	const countOf = (item: FacetListItem) =>
		item.count ?? (facetName ? facetDistribution?.[facetName]?.[item.key] ?? 0 : 0);
	// Each option's bar is measured against the largest option on show; headings carry a ring instead.
	const largest = Math.max(1, ...displayedList.filter((item) => !item.hide && !item.hideCount && !item.emphasis).map(countOf));
	const arrowSlot = displayedList.some((item) => item.showArrow);

	return (
		<div className="w-full flex flex-col gap-2" onKeyDownCapture={(event) => {
			// Found here rather than through a ref: a ref in inputProps replaces the
			// one React Aria uses to keep the input visible while the list is open.
			const picker = event.currentTarget;
			if (event.key === "Escape") requestAnimationFrame(() => picker.querySelector("input")?.focus({preventScroll: true}));
		}}>
			{/* <div className="text-lg font-medium text-black/80 dark:text-white/80 flex">
				<span>{label}</span>
			</div> */}
			<div className="text-lg font-medium text-black/80 dark:text-white/80 flex">
				<Autocomplete
					className="flex-1"
					classNames={
						fixedHeight ? { listboxWrapper: "h-64" } : undefined
					}
					isVirtualized={fixedHeight ? false : undefined}
					popoverProps={{ shouldCloseOnScroll: false }}
					placeholder={placeholder}
					label={label}
					key={label}
					fullWidth={true}
					scrollShadowProps={{
						isEnabled: false,
						size: 0,
						className: "scroll-py-0",
					}}
					selectedKey={isMultiSelect ? null : selectedKey}
					inputValue={search}
					onSelectionChange={(key) => {
						if (isMultiSelect && key === null) return;
						const item = displayedList!.find(
							(item) => item.key === key,
						);
						const functionToCall =
							item?.onSelectionChange || onSelectionChange;
						if (functionToCall) {
							if (item?.query) {
								functionToCall(item.query);
							} else {
								functionToCall(key);
							}
							setSearch("");
						}
					}}
					inputProps={{
						classNames: {
							inputWrapper:
								"bg-card_light dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
							input: twMerge(
								"placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
								isMultiSelect &&
									selectedKey.length > 0 &&
									"placeholder:text-black dark:placeholder:text-white",
							),
						},
					}}
					defaultFilter={(textValue, inputValue) => {
						return true;
					}}
					onInputChange={(value) => {
						setSearch(value);
					}}
					disabledKeys={allSectionNames.map(
						(name) => `section-${name}`,
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
											<HugeiconsIcon
												icon={ListViewIcon}
												className="size-8"
											/>
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
										// An option with no results is left out, unless it is chosen and so needs a way back.
										const chosen = isMultiSelect && (item.isSelected ?? selectedKey.includes(item.key));
										if (!chosen && (item.hideCount ? item.note?.startsWith("0 ") : countOf(item) === 0)) return null;
										return (
											<AutocompleteItem
												startContent={item.startContent}
												aria-label={item.label}
												key={item.key}
												classNames={{ title: "min-w-0 w-full", selectedIcon: "hidden" }}
												style={item.style}
												textValue={item.label}
											>
												<FacetOption
													label={item.label}
													count={item.hideCount ? null : countOf(item)}
													largest={largest}
													share={!item.hideCount && total ? shareOf(format, countOf(item), total) : null}
													shareValue={!item.hideCount && total ? countOf(item) / total : null}
													arrowSlot={arrowSlot}
													arrow={item.showArrow ? (item.isSelected ? "open" : "closed") : null}
													note={item.note}
													emphasis={item.emphasis}
													selected={chosen}
												/>
											</AutocompleteItem>
										);
									})
									.filter((item) => item !== null)}
							</Fragment>
						),
					)}
				</Autocomplete>
			</div>
		</div>
	);
}

/**
 * A section of a tree: a ring filled to its share of the results, its name, and its share and count. A long name
 * wraps, with the ring and figures on its first line; a narrow sidebar leaves the share's figure out and keeps the ring.
 */
function SectionTitle({ name, count, total, childCount, childNoun }: { name: string; count: number; total?: number; childCount: number; childNoun: [string, string] }) {
	const format = useFormatter();
	return (
		<span className="@container block w-full min-w-0">
			{/* Each mark sits on the name's first line (2xl: a 32px line). */}
			<span className="flex w-full min-w-0 items-start gap-3">
				{total ? <span className="mt-1.5 flex shrink-0"><ShareRing share={count / total} /></span> : null}
				<span className="min-w-0 flex-1 break-words">{name}</span>
				<span className="sr-only">
					{format.number(childCount)} {childCount === 1 ? childNoun[0] : childNoun[1]}
				</span>
				{total ? <span className="mt-2.5 hidden shrink-0 text-sm tabular-nums text-black/60 dark:text-white/60 @[20rem]:block">{shareOf(format, count, total)}</span> : null}
				<span className="mt-1.5 shrink-0 text-right text-base font-semibold tabular-nums text-black dark:text-white">{format.number(count)}</span>
			</span>
		</span>
	);
}

export function InnerCollectionList({
	data,
	facetDistribution,
	handleCheckboxChange,
	handleCountrySelect,
	selectedCollections,
	hierarchy,
	total,
	childNoun = ["collection", "collections"],
}: {
	/** What a section's children are called, one and many, for how many of them have results. */
	childNoun?: [string, string];
	data: CollectionsGetResponse | undefined;
	facetDistribution: FacetDistribution | undefined;
	handleCheckboxChange: (key: string) => void;
	handleCountrySelect: (country: string) => void;
	selectedCollections: string[];
	hierarchy: Collection[];
	/** How many results there are, for each row's share of them. */
	total?: number;
}) {
	const { filters } = useLibraryConfig();
	const defaultExpanded = filters.collectionsExpanded;
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
					([key]) => data.collections.some((c) => c.key === key),
				),
			),
		};
	}, [facetDistribution, data]);

	const displayedCollections = useMemo(() => {
		return hierarchy.filter(
			(collection) =>
				data?.collections.filter(
					(c) =>
						c.originalFacet === collection.key &&
						filteredFacetDistribution.collectionsAncestry[c.key],
				).length,
		);
	}, [hierarchy, data, filteredFacetDistribution]);

	const sectionCount = (key: string) => filteredFacetDistribution.collectionsAncestry[key] ?? 0;

	return displayedCollections.length > 0 ? (
		<Accordion
			defaultSelectedKeys={
				accordionGlobalExpanded
					? Object.keys(accordionGlobalExpanded)
					: defaultExpanded
						? hierarchy.map((c) => c.key)
						: []
			}
			onSelectionChange={(keys) => {
				setAccordionGlobalExpanded(
					Array.from(keys as Set<string>).reduce(
						(acc: Record<string, boolean>, key: string) => ({
							...acc,
							[key]: !acc[key],
						}),
						{} as Record<string, boolean>,
					),
				);
			}}
			selectionMode="multiple"
			fullWidth={false}
			variant="shadow"
			className="bg-card_light dark:bg-card p-6 rounded-xl rounded-t-none shadow-none"
			itemClasses={{
				// The title takes the row's width and no more, so a long name truncates instead of pushing the figures out.
				titleWrapper: "min-w-0 flex-1",
				title: "w-full min-w-0 text-black/80 dark:text-white/80 font-base text-2xl",
				// The chevron sits on the name's first line with the figures, however many lines the name takes.
				indicator: "self-start mt-2 text-black/80 dark:text-white/80",
				trigger: "p-0 items-start",
				base: "mb-4 last:mb-0",
				content: "py-0 pt-2",
			}}
			showDivider={false}
		>
			{displayedCollections.map((collection) => (
				<AccordionItem
					key={collection.key}
					aria-label={collection.title || collection.name || undefined}
					title={
						<SectionTitle
							name={collection.title || collection.name || collection.key}
							count={sectionCount(collection.key)}
							total={total}
							childCount={(collection.children ?? []).filter((child) => sectionCount(child.key) > 0).length}
							childNoun={childNoun}
						/>
					}
				>
					<CollectionCategory
						collection={collection}
						hierarchy={hierarchy}
						selectedCollections={selectedCollections}
						handleCheckboxChange={handleCheckboxChange}
						facetDistribution={filteredFacetDistribution}
						total={total}
					/>
				</AccordionItem>
			))}
		</Accordion>
	) : (
		<div className="text-lg bg-card_light dark:bg-card p-6 rounded-xl shadow-none text-black/80 dark:text-white/80 font-medium flex justify-center items-center gap-2 select-none">
			<HugeiconsIcon
				icon={Cancel01Icon}
				className="stroke-current size-6"
			/>
			<span>{t("noFacetsFound")}</span>
		</div>
	);
}

function CountryParser(
	queryParams: inferParserType<typeof searchParamsLoader>,
	countryCanditate: string,
	appendPath: boolean = false,
	queryParam?: keyof inferParserType<typeof searchParamsLoader>,
	onSelectionChange?: (value: any | null) => void,
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
					unoptimized
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
		// A region's count would add up its countries, counting a publication about two of them twice. A chosen country
		// keeps its count: the option hides its figures itself, and keeps their room.
		hideCount: ancestry.length <= 2,
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
	onSelectionChange?: (value: any | null) => void,
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

function TopicFilter({
	counts,
	onChange,
	selected,
	total,
}: {
	total: number;
	counts: Record<string, number> | undefined;
	onChange: (topics: string[]) => void;
	selected: string[];
}) {
	const tree = useTopicTree();

	if (tree.error) {
		return (
			<div
				role="status"
				className="flex items-center gap-2 text-sm text-black/55 dark:text-white/55"
			>
				<span>Could not load topics.</span>
				<Button
					size="xs"
					variant="transparent"
					onPress={() => void tree.mutate()}
				>
					Try again
				</Button>
			</div>
		);
	}

	const nodes = tree.data?.nodes ?? [];
	const byId = new Map(nodes.map((node) => [node.id, node]));
	// Topics without results under the other filters are left out.
	const shown = nodes
		.filter((node) => (counts?.[node.id] ?? 0) > 0)
		.map((node) => {
			const lineage = topicAncestry(node.id, byId);
			return {
				node,
				depth: lineage.length,
				path: lineage.map((id) => byId.get(id)!.name).join(" > "),
			};
		})
		.sort((left, right) => left.path.localeCompare(right.path));
	const parents = new Set(shown.map(({ node }) => node.parent));
	// A domain heads the list as it heads a section of the tree, with how many of its fields have results.
	const fieldsOf = (id: string) => shown.filter(({ node }) => node.parent === id).length;
	const row = (node: TopicTreeNode, depth: number | null): FacetListItem => ({
		key: node.id,
		label: node.name,
		...(depth !== null && node.parent === null
			? { emphasis: true, note: fieldsOf(node.id) === 1 ? "1 field" : `${fieldsOf(node.id)} fields` }
			: {}),
		count: counts?.[node.id],
		showArrow: depth !== null && parents.has(node.id),
		style:
			depth === null
				? undefined
				: { paddingLeft: `${depth * 1.25 - 0.75}rem` },
		isSelected: selected.includes(node.id),
		hide:
			depth !== null &&
			Boolean(node.parent && !selected.includes(node.parent)),
		onSelectionChange: () =>
			onChange(toggleTopicSelection(selected, node.id, nodes)),
	});

	return (
		<FacetPicker
			fixedHeight
			total={total}
			label="Topics"
			placeholder="Select topics"
			selectedKey={selected}
			list={shown.map(({ node, depth }) => row(node, depth))}
			searchList={shown.map(({ node }) => row(node, null))}
		/>
	);
}

/** Domains have no box in the tree, so one stays chosen only while something under it is. */
function withoutBareDomains(selected: string[], nodes: readonly TopicTreeNode[]) {
	const parents = new Map(nodes.map((node) => [node.id, node.parent]));
	const domainOf = (id: string): string => {
		const parent = parents.get(id);
		return parent ? domainOf(parent) : id;
	};
	const isDomain = (id: string) => parents.get(id) === null;
	const kept = new Set(selected.filter((id) => !isDomain(id)).map(domainOf));
	return selected.filter((id) => !isDomain(id) || kept.has(id));
}

/**
 * Topics in the collections' place, for a library without collections: each domain is a section and its fields,
 * subfields and topics open under it, through the same tree and counts the collections use.
 */
function TopicTree({
	counts,
	onChange,
	selected,
	total,
}: {
	total: number;
	counts: Record<string, number> | undefined;
	onChange: (topics: string[]) => void;
	selected: string[];
}) {
	const tree = useTopicTree();
	const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data]);
	const { hierarchy, collections } = useMemo(() => {
		const children = new Map<string | null, TopicTreeNode[]>();
		for (const node of nodes) children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
		const flat: Collection[] = [];
		// Shaped as the collection tree the accordion reads; topics have no other collection fields.
		const toCollection = (node: TopicTreeNode, level: number, root: string): Collection => {
			const shaped = {
				key: node.id,
				name: node.name,
				parentCollection: node.parent,
				level,
				originalFacet: root,
				children: (children.get(node.id) ?? []).map((child) => toCollection(child, level + 1, root)),
			} as unknown as Collection;
			flat.push(shaped);
			return shaped;
		};
		return {
			hierarchy: (children.get(null) ?? []).map((root) => toCollection(root, 0, root.id)),
			collections: flat,
		};
	}, [nodes]);

	return (
		<InnerCollectionList
			data={{ collections }}
			facetDistribution={{ collectionsAncestry: counts ?? {} }}
			handleCheckboxChange={(id) => onChange(withoutBareDomains(toggleTopicSelection(selected, id, nodes), nodes))}
			handleCountrySelect={() => undefined}
			// A domain is its section's heading, never a box inside it, though choosing a field chooses its domain too.
			selectedCollections={selected.filter((id) => !hierarchy.some((root) => root.key === id))}
			hierarchy={hierarchy}
			total={total}
			childNoun={["field", "fields"]}
		/>
	);
}

function FiltersList({
	queryParams,
	handleCountrySelect,
	handleInstitutionSelect,
	handleTopicsChange,
	facetDistribution,
	topicsAsTree,
}: {
	queryParams: inferParserType<typeof searchParamsLoader>;
	handleCountrySelect: (country: string) => void;
	handleInstitutionSelect: (institution: string) => void;
	handleTopicsChange: (topics: string[]) => void;
	facetDistribution: FacetDistribution | undefined;
	/** The topics are a tree below the filters instead of a picker among them. */
	topicsAsTree: boolean;
}) {
	const { filters, topics } = useLibraryConfig();
	const topicPicker = topics.enabled && !topicsAsTree;
	const isInstitutionEnabled = filters.institution.mode !== "hidden";
	const total = useFacetTotal("*");
	// Topics are counted without the topic filter, so their shares are out of the results without it.
	const topicTotal = useFacetTotal("topicAncestors");
	const isCountryFocusEnabled = useLibraryFeature("countryFocus");

	const { globalExpanded, setGlobalExpanded } = useContext(CacheContext);

	const enabledCount = [
		isInstitutionEnabled,
		isCountryFocusEnabled,
		topicPicker,
	].filter(Boolean).length;

	const t = useTranslations("ui");

	const [institutions] = useFacetList(
		facetDistribution!,
		INSTITUTION_FILTER_FIELD,
		(institution) =>
			InstitutionParser(
				institution,
				queryParams,
				handleInstitutionSelect,
			),
	);
	const institutionLabel = localizeOrUseIfCapitalized(
		filters.institution.label,
		t,
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
				handleCountrySelect,
			),
		(a, b) => a.localeCompare(b),
	);
	// A region's count would add up its countries, counting a publication about two of them twice, so a region says
	// how many of its countries have results instead.
	const countriesWithNotes = useMemo(
		() =>
			countries.map((item) => {
				if (!item.hideCount || item.key.split(" > ").length > 2) return item;
				const found = Object.entries(facetDistribution?.country ?? {}).filter(
					([path, count]) => count > 0 && path.startsWith(`${item.key} > `) && /^[A-Z]{2}$/.test(path.split(" > ").pop() ?? ""),
				).length;
				return { ...item, note: found === 1 ? "1 country" : `${found} countries`, emphasis: !item.key.includes(" > ") };
			}),
		[countries, facetDistribution],
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
				handleCountrySelect,
			),
		(a, b) => a.localeCompare(b),
	);

	const countryFocusFilter = useMemo(() => {
		return (
			isCountryFocusEnabled && (
				<FacetPicker
					key={"country-focus-filter"}
					total={total}
					label={t("countryFilter")}
					placeholder={t("countryFilterDescription")}
					selectedKey={queryParams.country}
					onSelectionChange={handleCountrySelect}
					facetDistribution={facetDistribution}
					list={countriesWithNotes}
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
		countriesWithNotes,
		countries_uncategorized,
		total,
	]);

	const institutionFilter = useMemo(() => {
		return (
			isInstitutionEnabled && (
				<FacetPicker
					key="institution-filter"
					total={total}
					label={institutionLabel}
					placeholder={institutionLabel}
					selectedKey={queryParams.institution}
					onSelectionChange={handleInstitutionSelect}
					facetDistribution={facetDistribution}
					list={institutions}
					facetName={INSTITUTION_FILTER_FIELD}
				/>
			)
		);
	}, [
		facetDistribution,
		handleInstitutionSelect,
		institutionLabel,
		institutions,
		isInstitutionEnabled,
		queryParams.institution,
		total,
	]);

	const moreFilters = useMemo(() => {
		return (
			<>
				{institutionFilter}
				{countryFocusFilter}
				{topicPicker ? (
					<TopicFilter
						total={topicTotal}
						counts={facetDistribution?.topicAncestors}
						onChange={handleTopicsChange}
						selected={queryParams.topics}
					/>
				) : null}
			</>
		);
	}, [
		countryFocusFilter,
		facetDistribution?.topicAncestors,
		handleTopicsChange,
		institutionFilter,
		queryParams.topics,
		topicPicker,
		topicTotal,
	]);

	const isMoreFiltersOpen = globalExpanded["more-filters"] ?? true;
	const [moreFiltersMoving, setMoreFiltersMoving] = useState(false);
	const setIsMoreFiltersOpen = (value: boolean) => {
		setGlobalExpanded((prev: Record<string, boolean>) => ({
			...prev,
			["more-filters"]: value,
		}));
	};

	return enabledCount > 1 ? (
		<>
			<div
				className="flex flex-col"
				role="region"
				aria-label={t("moreFilters")}
			>
				<div className="flex justify-between items-center gap-4 pt-4">
					<h4
						className="text-lg font-medium text-black/80 dark:text-white/80 flex"
						id="more-filters-heading"
					>
						{t("moreFilters")}
					</h4>
					<Button
						isIconOnly
						variant="light"
						size="sm"
						radius="full"
						className={twMerge(
							"text-black/80 dark:text-white/80",
							isMoreFiltersOpen && "rotate-180",
						)}
						onClick={() => setIsMoreFiltersOpen(!isMoreFiltersOpen)}
						aria-expanded={isMoreFiltersOpen}
						aria-controls="more-filters-content"
						aria-labelledby="more-filters-heading"
					>
						<HugeiconsIcon
							icon={ArrowDown01Icon}
							aria-hidden="true"
						/>
						<span className="sr-only">
							{isMoreFiltersOpen
								? t("collapseFilters")
								: t("expandFilters")}
						</span>
					</Button>
				</div>
				<AnimatePresence initial={false}>
					{isMoreFiltersOpen && (
						// Clipped only while it opens or closes: open, the fields' focus outlines and glow reach past its edges.
						<motion.div
							initial={{ height: 0 }}
							animate={{ height: "auto" }}
							// A closing section keeps the props it had, so its clip is part of the exit itself.
							exit={{ height: 0, overflow: "hidden" }}
							onAnimationStart={() => setMoreFiltersMoving(true)}
							onAnimationComplete={() => setMoreFiltersMoving(false)}
							className={twMerge("flex flex-col gap-4", moreFiltersMoving && "overflow-hidden")}
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

/** The library page's highlights, rendered on the server, for both the sidebar and the Explore sheet. */
export const LibraryHighlightsSlot = createContext<ReactNode>(null);

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
	handleTopicsChange,
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
	handleTopicsChange: (topics: string[]) => void;
	hierarchy: Collection[];
	queryParams: inferParserType<typeof searchParamsLoader>;
}) {
	const t = useTranslations("ui");
	const isCollectionsEnabled = useLibraryFeature("collections");
	const { topics } = useLibraryConfig();
	const highlights = useContext(LibraryHighlightsSlot);
	const isAuthorFilterEnabled = useLibraryFeature("authorFilter");
	const { handleTypeSelect, handleAuthorSelect } = useFiltersContext();
	const topicsAsTree = topics.enabled && !isCollectionsEnabled;
	const collectionsTotal = useFacetTotal("collectionsAncestry");
	const topicsTotal = useFacetTotal("topicAncestors");
	const { filters, institutions: configuredInstitutions } =
		useLibraryConfig();
	const configuredYears = useMemo(
		() =>
			Object.keys(facetDistribution?.year ?? {}).sort(
				(left, right) => Number(right) - Number(left),
			),
		[facetDistribution],
	);
	const customFilterInstitution =
		filters.institution.mode === "facet-with-featured-value"
			? filters.institution.featuredValue
			: undefined;

	const customFilter = useMemo(() => {
		if (!customFilterInstitution) return null;
		const isCustomFilterInstitutionSelected =
			queryParams.institution.includes(customFilterInstitution || "");
		const configuredInstitution = findInstitutionWithLogo(
			configuredInstitutions,
			customFilterInstitution,
		);
		return (
			<Button
				color={
					isCustomFilterInstitutionSelected ? "tertiary" : "secondary"
				}
				variant={isCustomFilterInstitutionSelected ? "solid" : "flat"}
				onPress={() => handleInstitutionSelect(customFilterInstitution)}
				className="w-full flex justify-start mb-4"
				startContent={
					configuredInstitution?.logoUrl ? (
						<InstitutionLogo
							alt=""
							logoUrl={configuredInstitution.logoUrl}
						/>
					) : undefined
				}
				endContent={
					<HugeiconsIcon
						icon={FilterIcon}
						className="size-5 ml-auto"
					/>
				}
			>
				{t("filterBy")} {customFilterInstitution}
			</Button>
		);
	}, [
		configuredInstitutions,
		customFilterInstitution,
		queryParams.institution,
		handleInstitutionSelect,
		t,
	]);

	return (
		<aside
			id="collections"
			aria-label={t("filtersAndCollectionsAriaLabel")}
			className={twMerge(
				"w-full shrink-0 z-20",
				isModal
					? "block"
					: "hidden lg:block lg:w-[24rem] xl:w-[28.5rem]",
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
				<section className={twMerge("w-full sm:rounded-t-2xl flex flex-col gap-2 p-6 sticky top-0 lg:static z-20", SIDEBAR_GREY, !isCollectionsEnabled && !topicsAsTree && "rounded-b-2xl")}>
					{filters.years.enabled && (
						<YearFilter
							key={range}
							range={range}
							onRangeChange={handleRangeChange}
							years={configuredYears}
							counts={facetDistribution?.year}
						/>
					)}
					<FiltersList
						queryParams={queryParams}
						handleCountrySelect={handleCountrySelect}
						handleInstitutionSelect={handleInstitutionSelect}
						handleTopicsChange={handleTopicsChange}
						facetDistribution={facetDistribution}
						topicsAsTree={topicsAsTree}
					/>
				</section>
				{isCollectionsEnabled && (
					<section className="w-full">
						{/* <div className="p-4 pt-6 pb-0 bg-card_light dark:bg-card">
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
							total={collectionsTotal}
						/>
					</section>
				)}
				{topicsAsTree && (
					<section className="w-full" aria-label="Topics">
						<TopicTree
							total={topicsTotal}
							counts={facetDistribution?.topicAncestors}
							onChange={handleTopicsChange}
							selected={queryParams.topics}
						/>
					</section>
				)}
				<div className={twMerge("mt-4 flex flex-col gap-4", isModal && "px-6")}>
					<ResultsOverview
						facetDistribution={facetDistribution}
						range={range}
						types={queryParams.type}
						author={queryParams.author}
						onRangeChange={handleRangeChange}
						onTypeSelect={handleTypeSelect}
						onAuthorSelect={handleAuthorSelect}
						showYears={filters.years.enabled}
						showAuthors={isAuthorFilterEnabled}
					/>
				</div>
			</Skeleton>
			{highlights && <div className={twMerge("mt-4", isModal && "px-6 pb-6")}>{highlights}</div>}
		</aside>
	);
}
