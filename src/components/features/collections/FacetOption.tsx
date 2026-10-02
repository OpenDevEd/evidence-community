"use client";

import { useFormatter } from "next-intl";
import { ArrowDown01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { twMerge } from "@/lib/tw-merge";
import { barWidth } from "./ResultsOverview";

/** A small ring filled to a share: a sliver at least for any count, empty for none. */
export function ShareRing({ share }: { share: number }) {
	const radius = 7;
	const circumference = 2 * Math.PI * radius;
	const filled = share > 0 ? Math.max(0.03, Math.min(1, share)) : 0;
	return (
		<svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 -rotate-90 rtl:rotate-90 rtl:-scale-y-100">
			<circle cx="10" cy="10" r={radius} fill="none" strokeWidth="3.5" className="stroke-accent/15" />
			<circle cx="10" cy="10" r={radius} fill="none" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${filled * circumference} ${circumference}`} className="stroke-accent" />
		</svg>
	);
}

/**
 * An option with its figures at a glance. A heading with a count (a topic domain) reads as a tree's section does: a
 * ring for its share, then its name and figures. Other options show a bar against the largest option under them. The
 * chevron of an option that opens sits at the end, in a slot every option keeps when any can open, so counts line up.
 * A chosen option drops its figures for a tick; the dropdowns hide the list's own tick slot, so no option keeps room
 * for one.
 */
type OptionFigures = { count: number | null; share: string | null; arrow: "open" | "closed" | null; arrowSlot: boolean; note?: string; heading: boolean; hidden: string };

/** An option's note, share, count and chevron, in that order; a heading's note is for screen readers only. */
function Figures({ count, share, arrow, arrowSlot, note, heading, hidden }: OptionFigures) {
	const format = useFormatter();
	return (
		<>
			{note && <span className={heading ? "sr-only" : twMerge("shrink-0 text-right text-xs tabular-nums text-black/60 dark:text-white/60", hidden)}>{note}</span>}
			{share && <span className={twMerge("hidden shrink-0 text-xs tabular-nums text-black/60 dark:text-white/60 @[12rem]:block", hidden)}>{share}</span>}
			{count !== null && <span className={twMerge("min-w-8 shrink-0 text-right text-sm font-semibold tabular-nums", hidden)}>{format.number(count)}</span>}
			{arrowSlot && (
				<span className={twMerge("flex size-4 shrink-0", hidden)}>
					{arrow && <HugeiconsIcon icon={ArrowDown01Icon} className={twMerge("size-4", arrow === "closed" && "-rotate-90 rtl:rotate-90")} />}
				</span>
			)}
		</>
	);
}

export function FacetOption({ label, count, largest, share, shareValue, arrow, arrowSlot, note, emphasis = false, selected = false }: { label: string; count: number | null; largest: number; share: string | null; shareValue: number | null; arrow: "open" | "closed" | null; arrowSlot: boolean; note?: string; emphasis?: boolean; /** A chosen option shows its name and a tick: its figures stay in place, invisible, so it keeps its height. */ selected?: boolean }) {
	const heading = emphasis && count !== null;
	const hidden = selected ? "invisible" : "";
	return (
		// Measured against its own width: a narrow option, such as one of the From and To year pickers, leaves the share out.
		<span className="@container flex w-full min-w-0 flex-col gap-1 text-black dark:text-white">
			<span className="relative flex min-w-0 items-center gap-2">
				{heading && shareValue !== null && <span className={twMerge("flex shrink-0", hidden)}><ShareRing share={shareValue} /></span>}
				<TruncatedText text={label} className={twMerge("flex-1 leading-5", emphasis && "font-semibold")} />
				<Figures count={count} share={share} arrow={arrow} arrowSlot={arrowSlot} note={note} heading={heading} hidden={hidden} />
				{selected && <HugeiconsIcon icon={Tick01Icon} aria-hidden className="absolute end-0 top-1/2 size-4 -translate-y-1/2 text-accent" />}
			</span>
			{count !== null && !heading && (
				<span aria-hidden className={twMerge("block h-1 overflow-hidden rounded-full bg-accent/10", arrowSlot && "mr-6 rtl:ml-6 rtl:mr-0", hidden)}>
					<span className="block h-full rounded-full bg-accent/70" style={{ width: barWidth(count, largest) }} />
				</span>
			)}
		</span>
	);
}
