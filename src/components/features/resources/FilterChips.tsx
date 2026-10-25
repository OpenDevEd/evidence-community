"use client";
import { UNCERTAIN, studyType } from "@/lib/readings/study-types";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowTurnBackwardIcon, Delete02Icon } from "@hugeicons/core-free-icons";
import { ReactNode, Suspense, useRef } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
import { AnimatePresence, motion } from "framer-motion";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/nextui/Button";
import { useFiltersContext } from "@/context/FiltersProvider";
import { countryFacetOptions } from "@/constants/misc";
import Image from "next/image";
import { getCountryInfo } from "@/lib/utils";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import useSWR from "swr";
import { fetchTopicCatalog, useTopicTree } from "@/lib/topics/client";
import { toggleTopicSelection, topicAncestry } from "@/lib/topics/selection";
import { useSourcesLabel } from "@/components/features/collections/sources";
import { showsFilterChips, tagFilterChips, tagLabel, type TagFilter } from "@/lib/tag-filters";
import { chosenFilterCount } from "@/lib/searchParams";

/** The active filters as removable chips, shared by the navbar and the library listing. Kept apart from the listing so the navbar does not load it. */
function Chip({
	group,
	title,
	callback,
	classNames = {},
	startContent,
}: {
	group: string | undefined;
	title: string | undefined;
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
				classNames.button,
			)}
			onPress={() => {
				if (canClick.current) {
					callback();
					canClick.current = false;
				}
				debounceCanClick();
			}}
		>
			{group && (
				<span
					className={twMerge(
						"text-white dark:text-white/40 font-medium text-xs leading-3 dark:bg-black/50 bg-black/50 p-1 px-2 rounded-md",
						classNames.group,
					)}
				>
					{group}
				</span>
			)}
			{startContent}
			<span
				className={twMerge(
					"block max-w-filter-chip truncate",
					classNames.title,
				)}
			>
				{title}
			</span>
		</Button>
	);
}

// Concise label for the publication-year (`range`) chip — e.g. "2015",
// "2010–2020", "2010+", "–2020".
function yearChipTitle(range: string): string {
	const [rawStart, rawEnd] = range.includes("-")
		? range.split("-")
		: [range, range];
	const start = (rawStart || "").trim();
	const end = (rawEnd || "").trim();
	if (start && end) return start === end ? start : `${start}–${end}`;
	if (start) return `${start}+`;
	if (end) return `–${end}`;
	return range;
}

/** What a topic is in the catalog's tree, by the shape of its ID: its level's name in the sidebar messages, none for a topic. */
function topicLevel(id: string) {
	if (id.startsWith("domains/")) return "domain";
	if (id.startsWith("fields/")) return "field";
	if (id.startsWith("subfields/")) return "subfield";
	return null;
}

/** Its own component so only these chips wait, behind their own boundary, for the server's topic names on a first visit. */
function TopicChips({
	onChange,
	selected,
}: {
	onChange: (topics: string[]) => void;
	selected: string[];
}) {
	const t = useTranslations("ui");
	const sidebar = useTranslations("sidebar");
	const tree = useTopicTree({ seeded: true }).data?.nodes;
	// A topic no public item carries, from a saved link say, is looked up by ID.
	const unknown = tree
		? selected.filter((id) => !tree.some((node) => node.id === id))
		: [];
	const unknownNodes = useSWR(
		unknown.length ? ["topic-names", unknown.join(",")] : null,
		() => fetchTopicCatalog({ ids: unknown }).then(({ nodes }) => nodes),
		{ revalidateOnFocus: false },
	);
	// Chips wait for names rather than show IDs; the chip row is already open.
	if (!tree || (unknown.length && !unknownNodes.data && !unknownNodes.error)) {
		return null;
	}
	const nodes = [...tree, ...(unknownNodes.data ?? [])];
	const byId = new Map(nodes.map((node) => [node.id, node]));
	// One chip per chosen topic, its whole path in order, as collections show theirs: closing one closes what is under it.
	const pathOf = (id: string) => topicAncestry(id, byId).map((step) => byId.get(step)?.name ?? step).join(" > ");
	const chips = [
		...selected.filter((id) => byId.has(id)).sort((left, right) => pathOf(left).localeCompare(pathOf(right))),
		// A topic the catalog doesn't know still gets a chip, so it can be removed.
		...selected.filter((id) => !byId.has(id)),
	];

	const levelName = (id: string) => {
		const level = topicLevel(id);
		return level ? sidebar(level) : t("topic");
	};

	return chips.map((id) => {
		const node = byId.get(id);
		return (
			<motion.div
				key={`topic-${id}`}
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -10 }}
				transition={{ duration: 0.2 }}
			>
				<Chip
					group={levelName(id)}
					title={node?.name ?? t("unknownTopic")}
					callback={() =>
						onChange(
							node
								? toggleTopicSelection(selected, id, nodes)
								: selected.filter((topicId) => topicId !== id),
						)
					}
					classNames={{
						button: "bg-secondary dark:bg-secondary/70",
						title: "text-white dark:text-white",
					}}
				/>
			</motion.div>
		);
	});
}

/** One chip per chosen source, named as the library names it; they wait for the names rather than show keys. */
function SourceChips() {
	const t = useTranslations("ui");
	const label = useSourcesLabel();
	const { sources, queryParams, handleSourceSelect } = useFiltersContext();
	if (!sources) return null;
	const nameOf = new Map(sources.map((source) => [source.key, source.name]));
	return queryParams.sources.map((key) => (
		<motion.div
			key={`source-${key}`}
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -10 }}
			transition={{ duration: 0.2 }}
		>
			<Chip
				group={label}
				// A source the library no longer has, from a saved link say, still gets a chip so it can be removed.
				title={nameOf.get(key) ?? t("unknownSource")}
				callback={() => handleSourceSelect(key)}
				classNames={{
					button: "bg-secondary dark:bg-secondary/70",
					title: "text-white dark:text-white",
				}}
			/>
		</motion.div>
	));
}

/** Every tag ticked, defaults too, and a filter whose defaults the reader emptied, so the row shows what the list holds. */
function useTagChips() {
	const { filters } = useLibraryConfig();
	const { tagTicks } = useFiltersContext();
	const { ticked, emptied } = tagFilterChips(tagTicks, filters.tagFilters);
	return { tagChips: ticked, anyChips: emptied, resets: filters.tagFilters.some((filter) => filter.enabled && filter.defaults.length > 0) };
}

const CHIP_MOTION = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 }, transition: { duration: 0.2 } };

/** The tag filters' chips, as direct children of the row's AnimatePresence so each one leaves with its own motion. */
function tagChipElements(
	anyChips: TagFilter[],
	tagChips: { filter: TagFilter; tag: string }[],
	anyLabel: string,
	onReset: (filterId: string) => void,
	onSelect: (filterId: string, tag: string) => void,
) {
	return [
		...anyChips.map((filter) => (
			<motion.div key={`tag-any-${filter.id}`} {...CHIP_MOTION}>
				<Chip
					group={filter.label}
					title={anyLabel}
					callback={() => onReset(filter.id)}
					classNames={{ button: "bg-black/10 dark:bg-white/10", group: "bg-black/40 dark:bg-black/50", title: "text-black/80 dark:text-white/80" }}
				/>
			</motion.div>
		)),
		...tagChips.map(({ filter, tag }) => (
			<motion.div key={`tag-${filter.id}-${tag}`} {...CHIP_MOTION}>
				<Chip
					group={filter.label}
					title={tagLabel(filter, tag)}
					callback={() => onSelect(filter.id, tag)}
					classNames={{ button: "bg-success/80 dark:bg-success/80", title: "text-white dark:text-white" }}
				/>
			</motion.div>
		)),
	];
}

/** Clears the filters; where the library has defaults it puts them back, so it says Reset. */
function ClearButton({ resets, onPress }: { resets: boolean; onPress: () => void }) {
	const t = useTranslations("ui");
	return resets ? (
		<Button
			onPress={onPress}
			size="sm"
			variant="solid"
			color="accent"
			className="h-7 min-w-0 gap-1.5 px-2.5 text-xs font-medium text-white"
			startContent={<HugeiconsIcon icon={ArrowTurnBackwardIcon} aria-hidden="true" className="size-3.5" />}
		>
			{t("resetFilters")}
		</Button>
	) : (
		<Button aria-label={t("clearFiltersAriaLabel")} onPress={onPress} isIconOnly size="sm" variant="solid" color="accent" className="h-7 w-7 min-w-7">
			<HugeiconsIcon icon={Delete02Icon} aria-hidden="true" className="text-white size-3" />
		</Button>
	);
}

export function FilterChips() {
	// Reads the shared, app-level filter state so the navbar chips and the
	// library chips are the exact same resident instance (no remount flash).
	const itemsContext = useFiltersContext();
	const { topics, filters } = useLibraryConfig();
	const t = useTranslations("ui");
	const itemTypeName = useTranslations("itemType");
	const studyTypes = useTranslations("studyTypes");
	const selectedTopics = topics.enabled
		? (itemsContext.queryParams.topics ?? [])
		: [];
	// Topics count only where the library has them, as their chips show.
	const chosen = { ...itemsContext.queryParams, topics: selectedTopics };
	const filtersCount = chosenFilterCount(chosen);
	const { anyChips, tagChips, resets } = useTagChips();
	const shown = showsFilterChips(chosen, filters.tagFilters);

	return (
		<div
			className={twMerge(
				"flex max-h-0 overflow-y-hidden transition-all duration-200 opacity-0 mb-0",
				shown && "max-h-filter-chips mb-4 opacity-100",
			)}
		>
			{/* On mobile the chips scroll horizontally inside their own track so a
			    long chip can't push the whole row (and the clear button) off-screen;
			    on sm+ they wrap as before. */}
			<div className="relative flex min-w-0 flex-1 gap-2 overflow-x-auto [&>div]:shrink-0 [scrollbar-width:none] sm:flex-wrap sm:overflow-x-visible [&::-webkit-scrollbar]:hidden">
				<AnimatePresence initial={false} mode="popLayout">
					{selectedTopics.length > 0 ? (
						<Suspense fallback={null}>
							<TopicChips
								onChange={itemsContext.handleTopicsChange}
								selected={selectedTopics}
							/>
						</Suspense>
					) : null}
					<SourceChips />
					{itemsContext.queryParams?.range && (
						<motion.div
							key={"year-" + itemsContext.queryParams.range}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{ duration: 0.2 }}
						>
							<Chip
								key={"year-" + itemsContext.queryParams.range}
								group={t("year")}
								title={yearChipTitle(
									itemsContext.queryParams.range,
								)}
								callback={() =>
									itemsContext.handleRangeChange?.(null, null)
								}
								classNames={{
									button: "bg-success/80 dark:bg-success/80",
									title: "text-white dark:text-white",
								}}
							/>
						</motion.div>
					)}
					{itemsContext.queryParams.type.map((type) => (
						<motion.div
							key={"type-" + type}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{ duration: 0.2 }}
						>
							<Chip
								group={t("typeLabel")}
								title={itemTypeName.has(type) ? itemTypeName(type) : type}
								callback={() => itemsContext.handleTypeSelect(type)}
								classNames={{
									button: "bg-success/80 dark:bg-success/80",
									title: "text-white dark:text-white",
								}}
							/>
						</motion.div>
					))}
					{tagChipElements(anyChips, tagChips, t("tagFilterAny"), itemsContext.handleTagReset, itemsContext.handleTagSelect)}
					{itemsContext.queryParams.study.map((study) => (
						<motion.div
							key={"study-" + study}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{ duration: 0.2 }}
						>
							<Chip
								group={studyTypes("chip")}
								title={study === UNCERTAIN ? studyTypes("uncertainType.label") : studyType(study) ? studyTypes(`types.${study}.label`) : study}
								callback={() => itemsContext.handleStudySelect(study)}
								classNames={{
									button: "bg-success/80 dark:bg-success/80",
									title: "text-white dark:text-white",
								}}
							/>
						</motion.div>
					))}
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
										group={t(facet.label)}
										title={label}
										startContent={
											countryName && (
												<Image
													unoptimized
													src={`https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`}
													alt={value}
													width={16}
													height={12}
													className="ml-0.5"
												/>
											)
										}
										callback={() =>
											(itemsContext as any)[facet.action](
												value,
											)
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
										callback={() =>
											itemsContext.handleInstitutionSelect?.(
												institution,
											)
										}
										classNames={{
											button: "bg-accent/80 dark:bg-accent/80",
											title: "text-white dark:text-white",
										}}
									/>
								</motion.div>
							),
						)}
					{itemsContext.collectionsData &&
						itemsContext.selectedCollections?.map(
							(collection: string) => {
								const collectionData =
									itemsContext.collectionsData?.collections.find(
										(c) => c.key === collection,
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
											// Fall back to the raw key when the
											// collection isn't in the loaded tree,
											// so the chip still reads sensibly.
											title={
												collectionData?.name ||
												collection
											}
											callback={() =>
												itemsContext.handleCheckboxChange?.(
													collection,
												)
											}
										/>
									</motion.div>
								);
							},
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
								group={"Author"}
								title={itemsContext.queryParams.author}
								callback={() =>
									itemsContext.handleAuthorSelect?.(
										itemsContext.queryParams.author,
									)
								}
								classNames={{
									button: "bg-tertiary dark:bg-tertiary/40",
									title: "text-white dark:text-white",
								}}
							/>
						</motion.div>
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
						className={twMerge("shrink-0 flex justify-end", !resets && "w-7")}
					>
						<ClearButton resets={resets} onPress={itemsContext.handleClearFilters} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
