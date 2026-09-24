"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { ReactNode, useRef } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { AnimatePresence, motion } from "framer-motion";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/nextui/Button";
import { useFiltersContext } from "@/context/FiltersProvider";
import { countryFacetOptions } from "@/constants/misc";
import Image from "next/image";
import { getCountryInfo } from "@/lib/utils";

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

export function getFilterChipState(
	queryParams: Record<string, any>,
	handleClearFilters?: () => void,
) {
	const filtersCount =
		(queryParams.collections?.length || 0) +
		(queryParams.institution?.length || 0) +
		(queryParams.author ? 1 : 0) +
		(queryParams.range ? 1 : 0) +
		countryFacetOptions.reduce(
			(acc, facet) => acc + (queryParams[facet.queryParam]?.length || 0),
			0,
		);
	const clearButton = () => {
		handleClearFilters?.();
	};

	return {
		filtersCount,
		clearButton,
	};
}

export function FilterChips() {
	// Reads the shared, app-level filter state so the navbar chips and the
	// library chips are the exact same resident instance (no remount flash).
	const itemsContext = useFiltersContext();
	const t = useTranslations("ui");
	const { filtersCount, clearButton } = getFilterChipState(
		itemsContext.queryParams,
		itemsContext.handleClearFilters,
	);

	return (
		<div
			className={twMerge(
				"flex max-h-0 overflow-y-hidden transition-all duration-200 opacity-0 mb-0",
				filtersCount > 0 && "max-h-filter-chips mb-4 opacity-100",
			)}
		>
			{/* On mobile the chips scroll horizontally inside their own track so a
			    long chip can't push the whole row (and the clear button) off-screen;
			    on sm+ they wrap as before. */}
			<div className="relative flex min-w-0 flex-1 gap-2 overflow-x-auto [&>div]:shrink-0 [scrollbar-width:none] sm:flex-wrap sm:overflow-x-visible [&::-webkit-scrollbar]:hidden">
				<AnimatePresence initial={false} mode="popLayout">
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
												<Image unoptimized
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
						className="w-7 shrink-0 flex justify-end"
					>
						<Button
							aria-label={t("clearFiltersAriaLabel")}
							onPress={clearButton}
							isIconOnly
							size="sm"
							variant="solid"
							color="accent"
							className="h-7 w-7 min-w-7"
						>
							<HugeiconsIcon
								icon={Delete02Icon}
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
