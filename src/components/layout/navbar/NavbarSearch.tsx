"use client";

import {
	HugeiconsIcon,
	type IconSvgElement,
} from "@/components/icons/Hugeicon";
import {
	BookSearchIcon,
	CompassIcon,
	Search01Icon,
	Sorting01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryStates } from "nuqs";
import dynamic from "next/dynamic";
import { useRouter, Link, usePathname } from "@/i18n/routing";
import { useFormatter, useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
import useSWR from "swr";
import { Spinner, useDisclosure } from "@nextui-org/react";
import { HOVER_CARD_CLOSE_DELAY, HOVER_CARD_DELAY, Tooltip } from "@/components/nextui/Tooltip";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Pagination } from "@/components/nextui/Pagination";
import { ItemsGetResponse } from "@/app/api/items/types";
import { listingParams, searchParamsLoader, serializeSearchParams } from "@/lib/searchParams";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { useEarlyTyping } from "@/hooks/useEarlyTyping";
import { followsInThisTab } from "@/lib/follows-in-this-tab";
import { SORT_OPTIONS } from "@/constants/items";
import { hasAnyTag } from "@/lib/tags";
import { showsFilterChips } from "@/lib/tag-filters";
import { findInstitutionWithLogo } from "@/config/library-config/institutions";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import {
	getRuntimeSearchScopeOptions,
	resolveRuntimeSearchScope,
} from "@/config/library-config/search";
import { resolveSearchQuery } from "@/lib/search-query";
import {
	PublicationHoverPreview,
	PublicationStatusBadges,
	hasBylineDetails,
	hasPreviewDetails,
	PreviewInstitutionLogo,
	publicationPreviewData,
	type PublicationPreviewData,
} from "@/components/features/items/PublicationHoverPreview";
import { OpenAccessLabel } from "@/components/features/items/OpenAccessLabel";

// Lazily loaded so the heavy collections/filters graph stays out of the
// always-present navbar bundle until the user opens Explore.
const NavbarExplore = dynamic(() => import("./NavbarExplore"), { ssr: false });
// Active-filter chips: lazy, and only mounted when filters actually exist. Until they load, a row of one chip's height
// holds their place, so the page below doesn't move down when they arrive.
// ponytail: one line is reserved; chips that wrap onto a second line still push the page down when they load. Server-render
// the chips if that needs to hold still too.
const NavbarFilterChips = dynamic(() => import("./NavbarFilterChips"), {
	ssr: false,
	loading: () => <div className="h-7" />,
});

/**
 * Secondary search bar docked to the bottom of the navbar.
 *
 * The search field is a live autocomplete: as you type it queries the items
 * API (refined by the scope + sort dropdowns) and shows matching resources in
 * a dropdown. Clicking a suggestion opens that item; pressing Enter or the
 * "see all" row opens the full library results (`/lib?…`).
 *
 * Visibility (runtime feature + hiding on pages that own their own search) is
 * decided by the navbar.
 */

function DropDownIcon({
	Icon,
	label,
}: {
	Icon: IconSvgElement;
	label?: string;
}) {
	return (
		<div className="size-8 bg-white/10 rounded-full p-2 aspect-square shrink-0">
			<HugeiconsIcon
				icon={Icon}
				className="w-full h-full"
				aria-label={label}
			/>
		</div>
	);
}

const selectClassNames = {
	// Full width until xl (the Select's "sm" size variant caps base at max-w-52,
	// so override it), then capped onto one row with the search at xl.
	base: "!mt-0 w-full !max-w-none xl:!max-w-64 shrink-0",
	mainWrapper: "w-full h-10 lg:h-12",
	label: "hidden",
};

// Scope labels are long ("Title, abstract, authors and keywords"), so give
// the scope select more room than sort to reduce truncation.
const scopeSelectClassNames = {
	...selectClassNames,
	base: "!mt-0 w-full !max-w-none xl:!max-w-96 shrink-0",
};

type SuggestionLabels = {
	comingSoon: string;
	institutionAlt: (name: string) => string;
	internal: string;
};

function SuggestionByline({
	preview,
	labels,
}: {
	preview: PublicationPreviewData;
	labels: SuggestionLabels;
}) {
	const { authors, institution, isComingSoon, isInternal } = preview;
	if (!hasBylineDetails(preview)) return null;

	return (
		<span className="flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50">
			<PreviewInstitutionLogo
				institution={institution}
				institutionAlt={labels.institutionAlt}
				size="small"
			/>
			{authors && <span className="min-w-0 truncate">{authors}</span>}
			<OpenAccessLabel openAccess={preview.openAccess} className="gap-1" iconClassName="size-3.5" />
			<PublicationStatusBadges
				comingSoon={isComingSoon}
				internal={isInternal}
				comingSoonLabel={labels.comingSoon}
				internalLabel={labels.internal}
			/>
		</span>
	);
}

function suggestionRowClassName(isCurrent: boolean, isHighlighted: boolean) {
	// A transparent left border on every row keeps alignment; the current item
	// gets an accent bar and tint to mark "you are here".
	return twMerge(
		"flex cursor-pointer flex-col gap-0.5 border-l-2 border-l-transparent px-4 py-2 no-underline",
		isCurrent && "border-l-accent bg-accent/5",
		isHighlighted && "bg-accent/10",
	);
}

function suggestionTitleClassName(isCurrent: boolean) {
	return twMerge(
		"line-clamp-1 text-sm font-medium text-black/80 dark:text-white/80",
		isCurrent && "text-accent dark:text-accent",
	);
}

function SuggestionRow({
	href,
	isCurrent,
	isHighlighted,
	onFollow,
	onHighlight,
	preview,
	title,
	labels,
}: {
	href: string;
	isCurrent: boolean;
	isHighlighted: boolean;
	onFollow: (event: React.MouseEvent) => void;
	onHighlight: () => void;
	preview: PublicationPreviewData;
	title?: string;
	labels: SuggestionLabels;
}) {
	return (
		<Link
			href={href}
			onClick={onFollow}
			onMouseEnter={onHighlight}
			role="option"
			aria-selected={isHighlighted}
			aria-current={isCurrent ? "true" : undefined}
			className={suggestionRowClassName(isCurrent, isHighlighted)}
		>
			<span className={suggestionTitleClassName(isCurrent)}>
				{title || "-"}
			</span>
			<SuggestionByline preview={preview} labels={labels} />
		</Link>
	);
}

export default function NavbarSearch() {
	const tLabels = useTranslations("searchControls");
	const router = useRouter();
	const t = useTranslations("ui");
	const tSorts = useTranslations("sorts");
	const tScopes = useTranslations("scopes");
	const formatter = useFormatter();
	const {
		content,
		filters,
		institutions: configuredInstitutions,
		resultLimit,
		search,
		topics,
	} = useLibraryConfig();

	// The item currently being viewed (when the bar is on an item/citation page),
	// so we can mark its row in the suggestions list.
	const pathname = usePathname();
	const currentItemKey =
		pathname.match(/^\/(?:lib|citation)\/([^/]+)/)?.[1] ?? null;

	// Shared URL state — the same nuqs params the /lib page uses. Every control
	// reads/writes these, and submitting carries them to /lib unchanged.
	const [params, setParams] = useQueryStates(searchParamsLoader);
	const scopeOptions = useMemo(
		() => getRuntimeSearchScopeOptions(search),
		[search],
	);
	const scope = resolveRuntimeSearchScope(params.scope, search);
	const sort = params.sort;
	const runtimeParams = useMemo(
		() => resolveSearchQuery(params, { filters, resultLimit, search, topics }).params,
		[filters, params, resultLimit, search, topics],
	);

	// The chips row appears when the library listing's own row would show a chip.
	const showsChips = showsFilterChips(runtimeParams, filters.tagFilters);

	// Keep an immediate draft while the debounced URL param still represents
	// the value from which the user started typing. Once the URL changes, it is
	// the source of truth again. This also handles browser navigation without
	// synchronizing state from an effect.
	const [searchDraft, setSearchDraft] = useState<{
		value: string;
		source: string;
	} | null>(null);
	const searchInput =
		searchDraft?.source === params.search
			? searchDraft.value
			: params.search;
	const [debounceSearch, , cancelSearch] = useDebounce(
		(value: string) => setParams({ search: value, page: 1 }),
		250,
	);

	const [isOpen, setIsOpen] = useState(false);
	const [highlight, setHighlight] = useState(-1);
	// containerRef anchors the dropdown; barRef is the whole bar, used for
	// outside-click detection so the scope/sort controls don't close the list.
	const containerRef = useRef<HTMLDivElement>(null);
	const barRef = useRef<HTMLDivElement>(null);
	// The scrollable results list, reset to the top whenever the page changes.
	const listRef = useRef<HTMLDivElement>(null);
	const {
		isOpen: isExploreOpen,
		onOpen: onExploreOpen,
		onOpenChange: onExploreOpenChange,
	} = useDisclosure();

	// Preview reflects the FULL current query (search + scope + sort + any
	// filters set via Explore) at the current page. We deliberately page through
	// the SAME `page` param with the SAME page size as the library, so a page
	// number means the identical set of results in the autocomplete and on /lib.
	//
	// An empty search is a valid query (it just browses everything matching the
	// current scope/filters), so we gate the fetch on the dropdown being open
	// rather than on there being search text — only fetching when it's shown.
	const query = isOpen ? buildItemsQuery(listingParams(runtimeParams), "/items") : null;

	const { data, isLoading, isValidating } = useSWR<ItemsGetResponse>(
		query,
		fetcher,
		{
			keepPreviousData: true,
			revalidateOnFocus: false,
			onSuccess: (d) => {
				// Mirror the library: if the active page fell past the end (e.g. the
				// result set shrank after a filter change), snap to the last page.
				if (d.totalPages > 0 && params.page > d.totalPages) {
					setParams({ page: d.totalPages });
				}
			},
		},
	);

	const results = data?.items ?? [];
	const totalItems = data?.totalItems ?? 0;
	const totalPages = data?.totalPages ?? 0;

	const trimmedSearch = searchInput.trim();
	// Busy while the user is still typing (debounce not yet applied to the
	// param) OR a request is in flight. Guards against flashing "no results"
	// mid-keystroke before the search has actually run.
	const isSearching =
		params.search.trim() !== trimmedSearch || isLoading || isValidating;
	const showDropdown = isOpen;

	// Close the dropdown when clicking outside the search field.
	useEffect(() => {
		function onPointerDown(event: MouseEvent) {
			const target = event.target as Element | null;
			if (!target) return;
			// Clicks anywhere inside the bar (search field, scope/sort) keep it open.
			if (barRef.current?.contains(target)) return;
			// The abstract tooltip and the scope/sort select popovers are
			// rendered in portals OUTSIDE this container, so a click there is
			// not really "outside" — ignore those too.
			if (target.closest?.('[role="tooltip"],[role="listbox"]')) return;
			setIsOpen(false);
		}
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, []);

	// The params to carry onward — the full current query plus the latest typed
	// search. If the search text has changed but not yet been committed (debounce
	// pending), reset to page 1 so the destination doesn't open on a stale page.
	const buildTargetParams = useCallback(() => {
		const trimmed = searchInput.trim();
		const searchChanged = trimmed !== params.search.trim();
		return {
			...runtimeParams,
			search: trimmed,
			page: searchChanged ? 1 : params.page,
		};
	}, [params.page, params.search, runtimeParams, searchInput]);

	// The address these open carries what was typed. A search still waiting would
	// write this page's address under that navigation and keep the reader here.
	const goToLibrary = useCallback(() => {
		cancelSearch();
		setIsOpen(false);
		router.push("/lib" + serializeSearchParams(buildTargetParams()));
	}, [router, buildTargetParams, cancelSearch]);

	const goToItem = useCallback(
		(key: string) => {
			cancelSearch();
			setIsOpen(false);
			// Open the item carrying the same params, so its navbar search picks
			// up exactly where the user was.
			router.push(
				`/lib/${key}` + serializeSearchParams(buildTargetParams()),
			);
		},
		[router, buildTargetParams, cancelSearch],
	);

	// A suggestion is a link of its own to the address goToItem builds. Opened in another tab, this one stays, and so
	// does its search.
	const followSuggestion = useCallback(
		(event: React.MouseEvent) => {
			if (followsInThisTab(event)) cancelSearch();
			setIsOpen(false);
		},
		[cancelSearch],
	);

	const handlePreviewPageChange = useCallback(
		(page: number) => {
			setParams({ page });
			listRef.current?.scrollTo({ top: 0 });
		},
		[setParams],
	);

	const handleInput = (value: string) => {
		setSearchDraft({ value, source: params.search });
		setHighlight(-1);
		debounceSearch(value.trim());
		// Keep the dropdown open even when the field is emptied — no search is
		// still a valid query.
		setIsOpen(true);
	};

	useEarlyTyping(containerRef, searchInput, handleInput);

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setIsOpen(true);
			setHighlight((h) => Math.min(h + 1, results.length - 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setHighlight((h) => Math.max(h - 1, -1));
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (highlight >= 0 && results[highlight]) {
				goToItem(results[highlight].key);
			} else {
				goToLibrary();
			}
		} else if (event.key === "Escape") {
			setIsOpen(false);
		}
	};

	const handleScopeChange = (keys: any) => {
		const value = (keys as Set<string>).values().next().value;
		if (value) setParams({ scope: value });
	};

	const handleSortChange = (keys: any) => {
		const value = (keys as Set<string>).values().next().value;
		if (value) setParams({ sort: value });
	};

	return (
		<>
			<div
				ref={barRef}
				role="search"
				// Keyboard focus leaving the bar closes the list, as a click outside it does. No next target means the
				// window lost focus or a click landed on nothing focusable, which the mousedown listener judges. The
				// scope and sort pickers and Explore open in portals (a dialog around a listbox), so focus moving into
				// one stays.
				onBlur={(event) => {
					const next = event.relatedTarget as Element | null;
					if (!next || barRef.current?.contains(next)) return;
					if (next.closest('[role="tooltip"],[role="listbox"],[role="dialog"]')) return;
					setIsOpen(false);
				}}
				className="bg-secondary_light dark:bg-card border border-black/5 dark:border-white/5 xl:rounded-2xl !rounded-t-none !border-t-0 p-4 xl:p-6 flex flex-col gap-4"
			>
				<div className="flex flex-col gap-3 xl:flex-row xl:items-center">
					{/* Search field + autocomplete dropdown */}
					<div ref={containerRef} className="relative flex-1 min-w-0">
						<Input
							autoCorrect="off"
							value={searchInput}
							onChange={(e) => handleInput(e.target.value)}
							onFocus={() => setIsOpen(true)}
							onKeyDown={handleKeyDown}
							onClear={() => {
								setSearchDraft({
									value: "",
									source: params.search,
								});
								setParams({ search: "", page: 1 });
								// Clearing the text isn't the same as having nothing to
								// show — keep the dropdown open on the now-unfiltered list.
								setIsOpen(true);
							}}
							placeholder={t("search")}
							size="lg"
							classNames={{
								inputWrapper:
									"h-10 lg:h-12 min-h-10 lg:min-h-12",
							}}
							isClearable
							clearButtonLabel={t("clearSearch")}
							startContent={
								<HugeiconsIcon
									icon={Search01Icon}
									aria-label={t("searchIconAriaLabel")}
									className="size-6 text-black/60 dark:text-white/40"
								/>
							}
							endContent={
								isSearching ? (
									<Spinner
										size="sm"
										color="current"
										className="text-black/60 dark:text-white/40"
									/>
								) : undefined
							}
						/>

						{showDropdown && (
							<div
								role="listbox"
								aria-label={t("search")}
								className="absolute left-0 right-0 top-full mt-2 z-50 flex max-h-suggestions flex-col overflow-hidden rounded-2xl border border-black/5 bg-card_light shadow-xl dark:border-white/10 dark:bg-card"
							>
								<div
									ref={listRef}
									className="min-h-0 flex-1 overflow-y-auto py-2"
								>
									{results.length === 0 ? (
										<div className="px-4 py-6 text-center text-sm text-black/50 dark:text-white/50">
											{isSearching ? (
												<Spinner
													size="sm"
													color="current"
													className="text-black/60 dark:text-white/40"
												/>
											) : (
												t("noResourcesFound")
											)}
										</div>
									) : (
										results.map(
											(item: any, index: number) => {
												const preview =
													publicationPreviewData(
														item,
														{
															contentTags:
																content.tags,
															etAl: t("etAl"),
															formatter,
															institutions:
																configuredInstitutions,
															openAccessLabel:
																content.openAccessLabel,
														},
													);
												const isCurrent =
													!!currentItemKey &&
													item.key === currentItemKey;
												const row = (
													<SuggestionRow
														key={item.key}
														href={
															`/lib/${item.key}` +
															serializeSearchParams(
																buildTargetParams(),
															)
														}
														isCurrent={isCurrent}
														isHighlighted={
															highlight === index
														}
														onFollow={followSuggestion}
														onHighlight={() =>
															setHighlight(index)
														}
														preview={preview}
														title={item.title}
														labels={{
															comingSoon:
																t("inProgress"),
															institutionAlt: (
																name,
															) =>
																t(
																	"institutionLogoAlt",
																	{ name },
																),
															internal:
																t("internal"),
														}}
													/>
												);

												// Show the preview whenever there is anything to
												// show; the abstract falls back to a placeholder.
												if (!hasPreviewDetails(preview))
													return row;

												return (
													<Tooltip
														color="default"
														key={item.key}
														placement="right"
														delay={HOVER_CARD_DELAY}
														closeDelay={HOVER_CARD_CLOSE_DELAY}
														className="max-w-sm rounded-2xl border border-black/5 bg-card_light dark:border-white/10 dark:bg-card"
														content={
															<PublicationHoverPreview
																preview={
																	preview
																}
																comingSoonLabel={t(
																	"inProgress",
																)}
																institutionAlt={(
																	name,
																) =>
																	t(
																		"institutionLogoAlt",
																		{
																			name,
																		},
																	)
																}
																internalLabel={t(
																	"internal",
																)}
																noAbstractLabel={t(
																	"noAbstract",
																)}
															/>
														}
													>
														{row}
													</Tooltip>
												);
											},
										)
									)}
								</div>

								{/* Sticky footer: jump to the full library results on the left,
						    page through the matches in place on the right. */}
								{totalItems > 0 && (
									<div className="flex shrink-0 items-center justify-between gap-2 border-t border-black/5 bg-card_light px-3 py-2 dark:border-white/10 dark:bg-card">
										<button
											type="button"
											onClick={goToLibrary}
											className="shrink-0 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-accent hover:bg-accent/5"
										>
											{t("seeMore")} (
											{formatter.number(totalItems)})
										</button>
										{totalPages > 1 && (
											<Pagination
												showControls
												size="sm"
												siblings={0}
												page={params.page}
												total={totalPages}
												onChange={
													handlePreviewPageChange
												}
												classNames={{
													wrapper: "gap-0.5",
												}}
											/>
										)}
									</div>
								)}
							</div>
						)}
					</div>

					{/* Scope */}
					<Select
						aria-label={tLabels("searchScope")}
						startContent={
							<DropDownIcon
								Icon={BookSearchIcon}
								label={tLabels("scopeIcon")}
							/>
						}
						color="tertiary"
						selectedKeys={[scope]}
						onSelectionChange={handleScopeChange}
						items={scopeOptions}
						selectorIcon={<div className="hidden"></div>}
						classNames={scopeSelectClassNames}
						label={tLabels("searchScope")}
						labelPlacement="outside"
					>
						{(item: any) => (
							<SelectItem
								aria-label={tScopes(item.key)}
								key={item.key}
							>
								{tScopes(item.key)}
							</SelectItem>
						)}
					</Select>

					{/* Sort */}
					<Select
						aria-label={tLabels("sortBy")}
						startContent={
							<DropDownIcon
								Icon={Sorting01Icon}
								label={tLabels("sortIcon")}
							/>
						}
						selectedKeys={[sort]}
						onSelectionChange={handleSortChange}
						items={SORT_OPTIONS}
						selectorIcon={<div className="hidden"></div>}
						classNames={selectClassNames}
						label={tLabels("sortBy")}
						labelPlacement="outside"
					>
						{(item: any) => (
							<SelectItem
								aria-label={tSorts(item.key)}
								key={item.key}
							>
								{tSorts(item.key)}
							</SelectItem>
						)}
					</Select>

					{/* Explore — opens the full filter panel wired to the same params */}
					<Button
						startContent={
							<HugeiconsIcon icon={CompassIcon} className="size-5 shrink-0" />
						}
						onPress={onExploreOpen}
						className="h-10 w-full shrink-0 lg:h-12 xl:w-auto"
					>
						{t("explore")}
					</Button>
				</div>

				{/* The active filters as chips.
			    FilterChips carries a bottom margin meant for the library layout;
			    drop it here so the bar's own padding controls the spacing. */}
				{showsChips && (
					<div className="[&>div]:!mb-0">
						<NavbarFilterChips />
					</div>
				)}
			</div>

			{isExploreOpen && (
				<NavbarExplore
					isOpen={isExploreOpen}
					onOpenChange={onExploreOpenChange}
				/>
			)}
		</>
	);
}
