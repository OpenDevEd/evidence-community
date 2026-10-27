"use client";

import { AutocompleteItem } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useDebounce } from "@/hooks/useDebounce";

import { Autocomplete } from "../../nextui/Autocomplete";
import { Input } from "../../nextui/Input";
import { Switch } from "../../nextui/Switch";
import { FacetOption } from "./FacetOption";
import { shareOf, useFacetTotal } from "./ResultsOverview";

function YearPicker({
	label,
	selectedKey,
	onYearChange,
	years,
	counts,
}: {
	label?: string;
	selectedKey: string | null;
	/** A typed year waits for the reader to stop typing; one picked from the list applies `now`. */
	onYearChange: (year: string, now: boolean) => void;
	years: readonly string[];
	/** Results per year, counted without the year filter. */
	counts?: Record<string, number>;
}) {
	const format = useFormatter();
	// Years are counted without the year filter, so their shares are out of the results without it.
	const total = useFacetTotal("year");
	const largest = Math.max(1, ...years.map((year) => counts?.[year] ?? 0));
	const isYearsDropDownEnabled = useLibraryFeature("yearsDropdown");

	if (!isYearsDropDownEnabled) {
		return (
			<Input
				type="number"
				label={label}
				defaultValue={selectedKey || ""}
				onChange={(event) => onYearChange(event.target.value, false)}
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
			// Tab already commits the typed year (React Aria's keydown picks the focused option). In Firefox the blur that
			// follows runs before React re-renders, sees no pick, and commits again: it unpicks the year and empties the box.
			// The list still closes on a click outside, through the popover.
			shouldCloseOnBlur={false}
			onInputChange={(year) => onYearChange(year, false)}
			onSelectionChange={(key) => onYearChange(String(key || ""), true)}
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
	onRangeChange: (start: string | null, end: string | null) => void;
	years: readonly string[];
	counts?: Record<string, number>;
}) {
	const t = useTranslations("ui");
	const [start = "", end = ""] = range.split("-");
	// Both ends as the boxes last set them, and one wait for both: the range applies half a second after the reader stops
	// typing in either box. The filter remounts with every new range, and a wait that started before still applies, with
	// the ends this instance's boxes hold.
	const typed = useRef({ start, end });
	const [isRangeMode, setIsRangeMode] = useState(() => range.includes("-"));
	const [applySoon, , cancelApply] = useDebounce(onRangeChange, 500);

	function changeYear(ends: { start?: string; end?: string }, now: boolean) {
		Object.assign(typed.current, ends);
		const next = [typed.current.start, isRangeMode ? typed.current.end : null] as const;
		if (now) {
			cancelApply();
			onRangeChange(...next);
		} else applySoon(...next);
	}

	function handleModeChange(selected: boolean) {
		// The switch is the reader's latest choice. A year still waiting in the boxes goes with it, instead of applying
		// after it and turning the switch back. The other mode starts with no end.
		cancelApply();
		typed.current.end = "";
		setIsRangeMode(selected);
		if (!selected) {
			onRangeChange(typed.current.start, null);
			return;
		}

		// A Year cleared but still waiting has to clear the applied one too.
		if (typed.current.start || start) onRangeChange(typed.current.start, "");
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
								onYearChange={(year, now) => changeYear({ start: year }, now)}
								years={years}
								counts={counts}
							/>
							<YearPicker
								label={t("to")}
								selectedKey={end}
								onYearChange={(year, now) => changeYear({ end: year }, now)}
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
								onYearChange={(year, now) => changeYear({ start: year }, now)}
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
