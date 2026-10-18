"use client";

import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { flushSync } from "react-dom";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { twMerge } from "@/lib/tw-merge";
import type { Loaded, More } from "./client";
import type { ChainEntry } from "./data";
import { ClearChip, SearchRow, type Checks } from "./filter";
import { Chains, EvidenceIntro, PANEL, ResultList, type Checked, type Filters, type Found, type OnHover } from "./lists";
import { Stack, type Navigated } from "./panels";

/** The search, with the filter folded into its button, at the top of the screen: one row, so the map keeps its height. On the
 * wide panel's search band grey, its fields raised in white. */
function TopBar({ filters, onSearch, onTyped, checks }: { filters: Filters; onSearch: (text: string) => void; onTyped: (text: string | null) => void; checks: Checks }) {
	return (
		<div data-evidence-top className="fixed inset-x-3 top-[5.75rem] z-10 xl:hidden [@media(max-width:1279px)_and_(orientation:landscape)]:right-auto [@media(max-width:1279px)_and_(orientation:landscape)]:w-[calc(100%-min(26rem,55%)-1.5rem)]">
			<div className={twMerge(PANEL, "relative")}>
				{/* The band's grey laid over the panel, as on the wide panel, so the raised fields stand out in dark mode too. */}
				<div className="rounded-2xl bg-[#f2f3f6] p-2 dark:bg-black/10"><SearchRow search={filters.queryParams.search} onSearch={onSearch} onTyped={onTyped} checks={checks} /></div>
				<ClearChip {...checks} />
			</div>
		</div>
	);
}

/** The sheet's bar, in the wide panel's head grey, so it reads apart from what it holds. */
const BAR = "h-14 shrink-0 items-center truncate border-b border-black/[0.06] bg-[#e8eaef] px-5 text-sm font-semibold dark:border-white/[0.08] dark:bg-black/25";

/**
 * The sheet's bar: the name of what it shows, and the chevron that folds it down to this bar so the map has the screen, or opens
 * it again. Lying on its side, where the sheet is always open, it is the name alone.
 */
function SheetBar({ name, open, onFold }: { name: string; open: boolean; onFold: () => void }) {
	return (
		<>
			<h2 className={twMerge(BAR, "hidden [@media(max-width:1279px)_and_(orientation:landscape)]:flex")}>{name}</h2>
			<button type="button" aria-expanded={open} onClick={onFold} className={twMerge(BAR, "flex justify-between gap-3 outline-none hover:bg-[#e1e4ea] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-black/30 [@media(max-width:1279px)_and_(orientation:landscape)]:hidden")}>
				<span className="truncate">{name}</span>
				<HugeiconsIcon icon={ArrowUp01Icon} size={16} aria-hidden className={twMerge("shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
			</button>
		</>
	);
}

/**
 * Whether the sheet is open: lying on its side it always is. Standing up, folded at first, so the map has the screen, and opened by whatever needs reading in it, a paper
 * being opened (from the address, before the map fits it beside the sheet), a search or the filter.
 */
function useSheetOpen(target: number | null, found: Found | undefined) {
	// An address that opens a paper, or the appraised papers, opens the sheet from the first frame.
	const [open, setOpen] = useState(target !== null || Boolean(found));
	const cause = `${target ?? ""}|${found?.id ?? ""}`;
	const [seen, setSeen] = useState(cause);
	if (cause !== seen) {
		setSeen(cause);
		if (target !== null || found) setOpen(true);
	}
	return [open, setOpen] as const;
}

type SheetProps = {
	filters: Filters; onSearch: (text: string) => void; onTyped: (text: string | null) => void; found: Found | undefined; typing: boolean;
	loaded: Loaded | null; more: More | null; chains: ChainEntry[]; papers: number; checked: Checked; checks: Checks; selected: number | null;
	onOpenKey: (key: string) => void; onHover: OnHover; opened: Navigated; target: number | null; focus: string | null; onRefit: () => void;
};

const SHEET = "fixed inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-b-none pb-[env(safe-area-inset-bottom)] xl:hidden [@media(max-width:1279px)_and_(orientation:landscape)]:left-auto [@media(max-width:1279px)_and_(orientation:landscape)]:top-[5.75rem] [@media(max-width:1279px)_and_(orientation:landscape)]:h-auto [@media(max-width:1279px)_and_(orientation:landscape)]:w-[min(26rem,55%)] [@media(max-width:1279px)_and_(orientation:landscape)]:rounded-r-none [@media(max-width:1279px)_and_(orientation:landscape)]:rounded-bl-none";

/**
 * Below 1,280 px the map takes the screen. The search and the checks sit at the top. One sheet holds what the wide panel does,
 * the starting points or the search's or filter's papers, with an opened paper slid over them and its back arrow: along the
 * bottom when the screen stands up, folding down to its bar to show the map, and down the right side when it lies on its side.
 */
export function PhoneSheet(props: SheetProps) {
	const { found, loaded, more } = props;
	const [open, setOpen] = useSheetOpen(props.target, found);
	const still = useReducedMotion();
	// The sheet's new height is in the page before the map is fitted into the room it leaves.
	const fold = () => { flushSync(() => setOpen(!open)); props.onRefit(); };
	const list = found
		? <ResultList key={found.id} found={found} typing={props.typing} more={more} loaded={loaded} onOpen={props.opened.onOpen} onHover={props.onHover} />
		: (
			<>
				<EvidenceIntro titled={false} papers={props.papers} reviews={props.chains.length} checked={props.checked} />
				<Chains chains={props.chains} selected={props.selected} onOpenKey={props.onOpenKey} onHover={props.onHover} heading={false} />
			</>
		);
	return (
		<>
			<TopBar filters={props.filters} onSearch={props.onSearch} onTyped={props.onTyped} checks={props.checks} />
			<motion.div data-evidence-sheet data-folded={open ? undefined : ""} layout={!still} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className={twMerge(PANEL, SHEET, open ? "h-[50dvh]" : "h-14")}>
				<SheetBar name={props.focus ?? found?.title ?? "Starting points"} open={open} onFold={fold} />
				<div className={twMerge("min-h-0 flex-1 flex-col", open ? "flex" : "hidden [@media(max-width:1279px)_and_(orientation:landscape)]:flex")}>
					<Stack list={list} opened={props.opened} loaded={loaded} more={more} onHover={props.onHover} />
				</div>
			</motion.div>
		</>
	);
}
