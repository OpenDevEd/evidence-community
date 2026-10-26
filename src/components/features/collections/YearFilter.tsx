"use client";

import { AutocompleteItem } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useDebounce } from "@/hooks/useDebounce";
import type { RangeChange } from "@/hooks/useFilters";

import { Autocomplete } from "../../nextui/Autocomplete";
import { Input } from "../../nextui/Input";
import { Switch } from "../../nextui/Switch";
import { FacetOption } from "./FacetOption";
import { shareOf, useFacetTotal } from "./ResultsOverview";

function YearPicker({
	label,
	selectedKey,
	onSelectionChange,
	years,
	counts,
}: {
	label?: string;
	selectedKey: string | null;
	onSelectionChange: (value: string | number | null) => void;
	years: readonly string[];
	/** Results per year, counted without the year filter. */
	counts?: Record<string, number>;
}) {
	const format = useFormatter();
	// Years are counted without the year filter, so their shares are out of the results without it.
	const total = useFacetTotal("year");
	const largest = Math.max(1, ...years.map((year) => counts?.[year] ?? 0));
	const [debouncedOnSelectionChange] = useDebounce(
		onSelectionChange,
		500,
	);
	const isYearsDropDownEnabled = useLibraryFeature("yearsDropdown");

	if (!isYearsDropDownEnabled) {
		return (
			<Input
				type="number"
				label={label}
				defaultValue={selectedKey || ""}
				onChange={(event) =>
					debouncedOnSelectionChange(event.target.value)
				}
				classNames={{
					inputWrapper:
						"bg-card_light dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
					input:
						"[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
					label: "text-black/80 dark:text-white/80",
				}}
			/>
		);
	}

	return (
		<Autocomplete
			className="flex-1"
			label={label}
			fullWidth
			defaultInputValue={selectedKey || ""}
			allowsCustomValue
			onInputChange={debouncedOnSelectionChange}
			onSelectionChange={onSelectionChange}
			inputProps={{
				classNames: {
					inputWrapper:
						"bg-card_light dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
					input:
						"placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
				},
			}}
			itemHeight={48}
		>
			{years.map((year) => {
				const count = counts?.[year] ?? 0;
				return (
					<AutocompleteItem aria-label={year} key={year} textValue={year} classNames={{ title: "min-w-0 w-full", selectedIcon: "hidden" }}>
						<FacetOption
							label={year}
							count={counts ? count : null}
							largest={largest}
							share={counts && total ? shareOf(format, count, total) : null}
							shareValue={null}
							arrow={null}
							arrowSlot={false}
							selected={year === selectedKey}
						/>
					</AutocompleteItem>
				);
			})}
		</Autocomplete>
	);
}

export function YearFilter({
	range,
	onRangeChange,
	years,
	counts,
}: {
	range: string;
	onRangeChange: RangeChange;
	years: readonly string[];
	counts?: Record<string, number>;
}) {
	const t = useTranslations("ui");
	const [start = "", end = ""] = range.split("-");
	const [isRangeMode, setIsRangeMode] = useState(() => range.includes("-"));

	function handleModeChange(selected: boolean) {
		setIsRangeMode(selected);
		if (!selected) {
			onRangeChange(start, null);
			return;
		}

		if (start) onRangeChange(start, "");
	}

	return (
		<>
			<div className="flex text-lg font-medium text-black/80 dark:text-white/80">
				<span>{t("publicationYear")}</span>
				<div className="flex flex-1 items-center justify-end gap-4">
					<Switch
						isSelected={isRangeMode}
						onValueChange={handleModeChange}
						classNames={{ label: "text-sm font-normal" }}
					>
						{t("yearRange")}
					</Switch>
				</div>
			</div>
			<div>
				<AnimatePresence mode="popLayout" initial={false}>
					{isRangeMode ? (
						<motion.div
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: 10 }}
							key="year-range"
							layout
							className="flex w-full gap-4"
						>
							<YearPicker
								label={t("from")}
								selectedKey={start}
								onSelectionChange={(key) =>
									onRangeChange(String(key || ""), undefined)
								}
								years={years}
								counts={counts}
							/>
							<YearPicker
								label={t("to")}
								selectedKey={end}
								onSelectionChange={(key) =>
									onRangeChange(undefined, String(key || ""))
								}
								years={years}
								counts={counts}
							/>
						</motion.div>
					) : (
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
								selectedKey={start}
								onSelectionChange={(key) =>
									onRangeChange(String(key || ""), null)
								}
								years={years}
								counts={counts}
							/>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</>
	);
}
