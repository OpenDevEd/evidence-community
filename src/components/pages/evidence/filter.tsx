"use client";

import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { twMerge } from "@/lib/tw-merge";
import type { Loaded } from "./client";
import { FLAG, KINDS, VERDICTS } from "./data";
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

/** How many papers the filter highlights: in an open chain, those of the chain; else across the library. Null with nothing chosen. */
export function highlightedNow({ checkCounts, types, verdicts, loaded, shown }: { checkCounts: CheckCounts; types: ReadonlySet<number>; verdicts: ReadonlySet<number>; loaded: Loaded | null; shown: Selection | null }) {
	const all = highlightedCount(checkCounts, types, verdicts);
	if (all === null || !shown?.chain || !loaded) return all;
	return [...new Set(shown.chain.layers.flat())].filter(matchesChecks(loaded, types, verdicts)).length;
}

type Option = { key: number; name: string; count: number; icon?: ReactNode };

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
			<Button className={twMerge("flex h-12 w-full items-center gap-2 rounded-2xl bg-default-100 px-3 text-left outline-none transition-colors data-[hovered]:bg-default-200 data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent dark:bg-secondary dark:data-[hovered]:bg-white/[4%]", on && "bg-accent/10 text-accent ring-1 ring-inset ring-accent/40 data-[hovered]:bg-accent/15 dark:bg-accent/20 dark:text-white dark:ring-accent/60 dark:data-[hovered]:bg-accent/25")}>
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
export function MapFilter({ counts, types, verdicts, onTypes, onVerdicts }: Checks) {
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
		<div className="space-y-1.5">
			<div className="flex h-7 items-center justify-between pl-1">
				<span className="text-xs font-semibold">Filter the map</span>
				{/* Kept in place while hidden, so the heading never changes height. */}
				<button type="button" onClick={() => { onTypes(new Set()); onVerdicts(new Set()); }} className={twMerge("rounded-lg px-2 py-1 text-xs font-semibold text-accent outline-none hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent", !types.size && !verdicts.size && "invisible")}>Clear</button>
			</div>
			{/* Side by side below 1,280 px, where the top bar must stay short for the map; an option too long for its list wraps. */}
			<div className="flex gap-2 xl:flex-col">
				<FilterSelect label="Type" placeholder="Any type" options={typeOptions} selected={types} onChange={onTypes} />
				<FilterSelect label="Check" placeholder="Any check" options={checkOptions} selected={verdicts} onChange={onVerdicts} />
			</div>
		</div>
	);
}
