"use client";

import { ArrowDown01Icon, Cancel01Icon, FilterHorizontalIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";
import { SearchBar } from "@/components/features/SearchBar";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { filledInputSlots } from "@/components/nextui/field-styles";
import { twMerge } from "@/lib/tw-merge";
import type { Loaded } from "./client";
import { aroundOf, FLAG, KINDS, VERDICTS } from "./data";
import type { Selection } from "./graph";
import { muted } from "./lists";
import { VerdictIcon } from "./verdict-chip";
import { KIND_PLURAL, TYPE_ORDER, VERDICT, VERDICT_ORDER } from "./verdicts";

/** How many of the evidence map's papers a type and a check share, from the counts built with the map: types, then checks. */
export type CheckCounts = Record<string, Record<string, number>>;

/** The filter's counts, which types and checks are chosen, and how to change them. */
export type Checks = { counts: CheckCounts; types: ReadonlySet<number>; verdicts: ReadonlySet<number>; onTypes: (next: ReadonlySet<number>) => void; onVerdicts: (next: ReadonlySet<number>) => void };

/** The papers counted where both tests hold: a type and a check. */
const countWhere = (counts: CheckCounts, ofType: (kind: number) => boolean, ofCheck: (verdict: number) => boolean) =>
	Object.entries(counts).reduce((sum, [kind, checks]) => (ofType(Number(kind)) ? Object.entries(checks).reduce((all, [verdict, n]) => (ofCheck(Number(verdict)) ? all + n : all), sum) : sum), 0);

/** The checked papers, of every type. */
export const checkedCount = (counts: CheckCounts) => countWhere(counts, () => true, (verdict) => verdict > 0);

/** How many papers the filter highlights, or null with nothing chosen. */
export const highlightedCount = (counts: CheckCounts, types: ReadonlySet<number>, verdicts: ReadonlySet<number>) =>
	types.size || verdicts.size ? countWhere(counts, (kind) => !types.size || types.has(kind), (verdict) => !verdicts.size || verdicts.has(verdict)) : null;

/** Whether the filter lights a paper: of a type chosen, if any is, and with a check chosen, if any is. Methods references and strays
 * are never lit, as they are never counted. */
export const matchesChecks = ({ points }: Loaded, types: ReadonlySet<number>, verdicts: ReadonlySet<number>) => (i: number) =>
	!(points.flags[i] & (FLAG.methods | FLAG.stray)) && (!types.size || types.has(points.kind[i])) && (!verdicts.size || verdicts.has(points.verdict[i]));

/**
 * How many papers the filter highlights, null with nothing chosen: those lit on the map (where a search narrows the filter, the
 * papers both light), and with a paper open only those of its chain or its citations, as the map lights. Until the map's data
 * is in, the counts built with it.
 */
export function highlightedNow({ checkCounts, types, verdicts, lit, shown }: { checkCounts: CheckCounts; types: ReadonlySet<number>; verdicts: ReadonlySet<number>; lit: number[] | undefined; shown: Selection | null }) {
	const all = highlightedCount(checkCounts, types, verdicts);
	if (all === null || !lit) return all;
	if (!shown) return lit.length;
	const members = shown.chain ? shown.chain.layers.flat() : aroundOf(shown.index, shown.cites, shown.citedBy);
	const on = new Set(lit);
	return [...new Set(members)].filter((i) => on.has(i)).length;
}

type Option = { key: number; name: string; count: number; icon?: ReactNode };

/** The filter's fields and the search, raised in white off the tinted band the search sits on, where grey fields would melt into it. */
const RAISED = "bg-white shadow-[0_1px_2px_rgb(0_0_0/0.08)] data-[hovered]:bg-white/70 dark:bg-secondary-400 dark:data-[hovered]:bg-white/[6%]";
const RAISED_INPUT = { input: filledInputSlots.input, inputWrapper: "bg-white border-transparent shadow-[0_1px_2px_rgb(0_0_0/0.08)] data-[hover]:bg-white/70 group-data-[focus]:bg-white dark:bg-secondary-400 dark:data-[hover]:bg-white/[6%] dark:group-data-[focus]:bg-secondary-400 data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus" };

/**
 * One of the filter's dropdowns: any number of its options, each with how many papers it would highlight. Escape closes it and
 * keeps what is chosen, where a list on its own would clear it. The list is as wide as its field.
 */
function FilterSelect({ label, placeholder, options, selected, onChange }: { label: string; placeholder: string; options: Option[]; selected: ReadonlySet<number>; onChange: (next: ReadonlySet<number>) => void }) {
	// A dropdown with something chosen is tinted in the accent, so a filter that is on never reads as one that is off.
	const on = selected.size > 0;
	return (
		<Select selectionMode="multiple" value={[...selected]} onChange={(keys) => onChange(new Set(keys.map(Number)))} placeholder={placeholder} className="min-w-0 flex-1">
			<Label className="sr-only">{label}</Label>
			<Button className={twMerge("flex h-12 w-full items-center gap-2 rounded-2xl bg-default-100 px-3 text-left outline-none transition-colors data-[hovered]:bg-default-200 data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent dark:bg-secondary dark:data-[hovered]:bg-white/[4%]", RAISED, on && "bg-accent/10 text-accent ring-1 ring-inset ring-accent/40 data-[hovered]:bg-accent/15 dark:bg-accent/20 dark:text-white dark:ring-accent/60 dark:data-[hovered]:bg-accent/25")}>
				<span className="min-w-0 flex-1">
					<span aria-hidden className={twMerge("block text-xs leading-4", on ? "opacity-80" : muted)}>{label}</span>
					<SelectValue className={twMerge("block truncate text-sm font-medium leading-5", !on && muted)}>
						{({ isPlaceholder, selectedItems, selectedText }) => (isPlaceholder ? placeholder : selectedItems.length > 1 ? `${selectedItems.length} chosen` : selectedText)}
					</SelectValue>
				</span>
				<HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden className={on ? undefined : muted} />
			</Button>
			<Popover offset={6} className="w-[var(--trigger-width)] rounded-2xl border-small border-black/10 bg-white p-1 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.25)] outline-none data-[entering]:animate-in data-[entering]:fade-in data-[entering]:duration-150 dark:border-white/10 dark:bg-secondary">
				<ListBox escapeKeyBehavior="none" items={options} className="max-h-80 overflow-y-auto outline-none">
					{(option) => (
						<ListBoxItem id={option.key} textValue={option.name} className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-none data-[focused]:bg-black/[0.05] dark:data-[focused]:bg-white/10">
							{({ isSelected }) => (
								<>
									{option.icon}
									<span className="min-w-0 flex-1 font-medium leading-snug">{option.name}</span>
									<span className={twMerge("text-xs tabular-nums", muted)}>{option.count}</span>
									<HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden className={twMerge("text-accent", !isSelected && "invisible")} />
								</>
							)}
						</ListBoxItem>
					)}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The map's filter: a type and a check, each a dropdown of any number of options, highlighting papers on the map. Within a
 * dropdown any option chosen counts; with both, a paper must match each. An option's count is what it would highlight with the
 * other dropdown as it is.
 */
function MapFilter({ counts, types, verdicts, onTypes, onVerdicts }: Checks) {
	const inTypes = (kind: number) => !types.size || types.has(kind);
	const inChecks = (verdict: number) => !verdicts.size || verdicts.has(verdict);
	const typeOptions = TYPE_ORDER.filter((name) => counts[KINDS.indexOf(name)]).map((name) => {
		const kind = KINDS.indexOf(name);
		return { key: kind, name: KIND_PLURAL[name], count: countWhere(counts, (k) => k === kind, inChecks) };
	});
	const checkOptions = VERDICT_ORDER.map((name) => {
		const verdict = VERDICTS.indexOf(name);
		return { key: verdict, name: VERDICT[name].label, count: countWhere(counts, inTypes, (v) => v === verdict), icon: <VerdictIcon verdict={verdict} size={14} /> };
	});
	return (
		<div className="space-y-2">
			{/* Side by side below 1,280 px, where the top bar must stay short for the map; an option too long for its list wraps. */}
			<div className="flex gap-2 xl:flex-col">
				<FilterSelect label="Type" placeholder="Any type" options={typeOptions} selected={types} onChange={onTypes} />
				<FilterSelect label="Check" placeholder="Any check" options={checkOptions} selected={verdicts} onChange={onVerdicts} />
			</div>
		</div>
	);
}

/** The button at the end of the search that shows or hides the filter's fields, with how many choices are on. */
/** The filter button's look: in the accent with something chosen, pressed in while its fields are open, else raised. */
const toggleLook = (open: boolean, on: number) => (on ? "bg-accent/10 text-accent hover:bg-accent/15 dark:bg-accent/20 dark:text-white" : open ? "bg-white/70 shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:bg-white/[6%]" : "bg-white shadow-[0_1px_2px_rgb(0_0_0/0.08)] hover:bg-white/70 dark:bg-secondary-400 dark:hover:bg-white/[6%]");

function FilterToggle({ open, on, onPress }: { open: boolean; on: number; onPress: () => void }) {
	return (
		<button type="button" aria-expanded={open} aria-controls="evidence-filter" aria-label={on ? `Filter, ${on} on` : "Filter"} onClick={onPress} className={twMerge("relative grid size-12 shrink-0 place-items-center rounded-2xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", toggleLook(open, on))}>
			<HugeiconsIcon icon={FilterHorizontalIcon} size={20} aria-hidden />
			{on ? <span aria-hidden className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white tabular-nums">{on}</span> : null}
		</button>
	);
}

/**
 * The search and, folded under it until asked for, the filter's fields: one row, where it used to take four. Opening and folding
 * the fields slides them open and shut.
 */
export function SearchRow({ search, onSearch, onTyped, checks }: { search: string; onSearch: (text: string) => void; onTyped: (text: string | null) => void; checks: Checks }) {
	const [open, setOpen] = useState(false);
	const still = useReducedMotion();
	return (
		<div>
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1"><SearchBar handleSearchChange={onSearch} onTyped={onTyped} search={search} classNames={RAISED_INPUT} /></div>
				<FilterToggle open={open} on={checks.types.size + checks.verdicts.size} onPress={() => setOpen(!open)} />
			</div>
			<AnimatePresence initial={false}>
				{open && (
					<motion.div id="evidence-filter" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: still ? 0 : 0.28, ease: [0.32, 0.72, 0, 1] }} className="-mx-1 overflow-hidden px-1">
						<div className="pb-1 pt-2"><MapFilter {...checks} /></div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

/**
 * Clear filters, a chip floating on the lower edge of the search's band, half over the view under it: there only with something
 * chosen, and taking no room, so nothing moves as it comes and goes. Its band is `relative`.
 */
export function ClearChip({ types, verdicts, onTypes, onVerdicts }: Checks) {
	const still = useReducedMotion();
	// It drops out from behind the band's edge with a little spring, and tucks back up behind it.
	const hidden = { opacity: 0, y: still ? 0 : -8, scale: still ? 1 : 0.7 };
	const transition = still ? { duration: 0 } : { type: "spring" as const, stiffness: 520, damping: 26, mass: 0.6, opacity: { duration: 0.15 } };
	return (
		<AnimatePresence>
			{types.size + verdicts.size > 0 && (
				<div className="absolute inset-x-0 bottom-0 z-10 flex translate-y-1/2 justify-center">
					<motion.button type="button" initial={hidden} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ ...hidden, transition: { duration: still ? 0 : 0.14, ease: [0.4, 0, 1, 1] } }} transition={transition} whileTap={still ? undefined : { scale: 0.92 }} onClick={() => { onTypes(new Set()); onVerdicts(new Set()); }} className="inline-flex h-6 items-center gap-1 rounded-full bg-white pl-1.5 pr-2.5 text-[11px] font-semibold text-accent shadow-[0_2px_8px_-2px_rgb(0_0_0/0.25)] outline-none ring-1 ring-black/[0.06] hover:bg-accent/5 focus-visible:ring-2 focus-visible:ring-accent dark:bg-secondary-400 dark:text-white dark:ring-white/10">
						<HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden />
						Clear filters
					</motion.button>
				</div>
			)}
		</AnimatePresence>
	);
}
