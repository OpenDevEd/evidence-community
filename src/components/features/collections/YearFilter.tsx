"use client";

import { AutocompleteItem } from "@nextui-org/react";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, type ReactNode, type Ref } from "react";

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
			// Moving through the list with the arrow keys scrolls the page to centre it.
			popoverProps={{ shouldCloseOnScroll: false }}
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

/**
 * One mode's boxes, fading in and out as the switch turns. Boxes fading out stay in the page until they're gone, so they
 * take no focus meanwhile: Tab goes to the boxes replacing them. Inside Explore on a phone, NextUI's modal moves Tab
 * itself with the React Aria FocusScope it pins (@react-aria/focus 3.19.0), which skips `data-react-aria-prevent-focus`
 * but not `inert`, so the boxes carry both. `ref` is AnimatePresence's, which measures the boxes to lift them out of the
 * layout as they leave.
 */
function ModeBoxes({ ref, className, children }: { ref?: Ref<HTMLDivElement>; className: string; children: ReactNode }) {
	const leaving = !useIsPresent();
	return (
		<motion.div
			ref={ref}
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: 10 }}
			layout
			inert={leaving || undefined}
			data-react-aria-prevent-focus={leaving || undefined}
			className={className}
		>
			{children}
		</motion.div>
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
	// The range the boxes were filled from, the one this filter sent last, and how many times the boxes were filled. A range
	// this filter sent leaves the boxes, and the focus, where the reader left them. One from anywhere else (a chip, Clear,
	// the year bars) fills them again and sets the switch to match.
	const [shown, setShown] = useState({ range, sent: null as string | null, fills: 0 });
	const [isRangeMode, setIsRangeMode] = useState(() => range.includes("-"));
	// Each turn of the switch draws new boxes. A mode turned back on while it still fades out comes back as the same element,
	// and its boxes would keep the years they held.
	const [switches, setSwitches] = useState(0);
	if (range !== shown.range) {
		// A range pasted into the Year box (2020-2024, -2024) goes out as a range the switch doesn't show, so it counts as one
		// from elsewhere and turns the switch on. An empty range fits either mode.
		const sentHere = range === shown.sent && (!range || range.includes("-") === isRangeMode);
		setShown({ range, sent: null, fills: shown.fills + (sentHere ? 0 : 1) });
		if (!sentHere) setIsRangeMode(range.includes("-"));
	}
	// Both ends as the boxes last set them, since they were last filled.
	const typed = useRef({ fills: 0, start, end });
	function typedEnds() {
		if (typed.current.fills !== shown.fills) typed.current = { fills: shown.fills, start, end };
		return typed.current;
	}
	function send(from: string, to: string | null) {
		// No year at either end is no range, so the switch stays where the reader put it.
		const until = from || to ? to : null;
		setShown((current) => ({ ...current, sent: until === null ? from : `${from}-${until}` }));
		onRangeChange(from, until);
	}
	// One wait for both boxes: a typed year applies half a second after the reader stops typing in either. A range that
	// came from anywhere else in that time is newer, so the wait is dropped, even when it came back to the same range.
	const [applySoon, , cancelApply] = useDebounce((typedOver: string, fills: number, from: string, to: string | null) => {
		if (typedOver === range && fills === shown.fills) send(from, to);
	}, 500);

	function changeYear(ends: { start?: string; end?: string }, now: boolean) {
		const next = Object.assign(typedEnds(), ends);
		const to = isRangeMode ? next.end : null;
		if (now) {
			cancelApply();
			send(next.start, to);
		} else applySoon(range, shown.fills, next.start, to);
	}

	function handleModeChange(selected: boolean) {
		// The switch is the reader's latest choice. A year still waiting in the boxes goes with it, instead of applying
		// after it and turning the switch back. The other mode starts with no end.
		cancelApply();
		const next = typedEnds();
		next.end = "";
		setIsRangeMode(selected);
		setSwitches(switches + 1);
		if (!selected) {
			send(next.start, null);
			return;
		}

		// A Year cleared but still waiting has to clear the applied one too.
		if (next.start || start) send(next.start, "");
	}

	return (
		<>
			{/* On a phone at large text the switch takes a row of its own (year-filter-header in globals.css). */}
			<div className="@container/year-header">
				<div className="year-filter-header flex text-lg font-medium text-black/80 dark:text-white/80">
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
			</div>
			<div key={shown.fills}>
				<AnimatePresence mode="popLayout" initial={false}>
					{isRangeMode ? (
						<ModeBoxes key="year-range" className="flex w-full gap-4">
							<YearPicker
								key={`from-${switches}`}
								label={t("from")}
								selectedKey={start}
								onYearChange={(year, now) => changeYear({ start: year }, now)}
								years={years}
								counts={counts}
							/>
							<YearPicker
								key={`to-${switches}`}
								label={t("to")}
								selectedKey={end}
								onYearChange={(year, now) => changeYear({ end: year }, now)}
								years={years}
								counts={counts}
							/>
						</ModeBoxes>
					) : (
						<ModeBoxes key="same-year" className="w-full">
							<YearPicker
								key={switches}
								label={t("year")}
								selectedKey={start}
								onYearChange={(year, now) => changeYear({ start: year }, now)}
								years={years}
								counts={counts}
							/>
						</ModeBoxes>
					)}
				</AnimatePresence>
			</div>
		</>
	);
}
