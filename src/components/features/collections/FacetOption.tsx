"use client";

import { useFormatter } from "next-intl";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
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
 */
export function FacetOption({ label, count, largest, share, shareValue, arrow, arrowSlot, note, emphasis = false }: { label: string; count: number | null; largest: number; share: string | null; shareValue: number | null; arrow: "open" | "closed" | null; arrowSlot: boolean; note?: string; emphasis?: boolean }) {
	const format = useFormatter();
	const heading = emphasis && count !== null;
	return (
		// Measured against its own width: a narrow option, such as one of the From and To year pickers, leaves the share out.
		<span className="@container flex w-full min-w-0 flex-col gap-1 text-black dark:text-white">
			<span className="flex min-w-0 items-center gap-2">
				{heading && shareValue !== null && <ShareRing share={shareValue} />}
				<TruncatedText text={label} className={twMerge("flex-1 leading-5", emphasis && "font-semibold")} />
				{note && <span className={heading ? "sr-only" : "shrink-0 text-right text-xs tabular-nums text-black/60 dark:text-white/60"}>{note}</span>}
				{share && <span className="hidden shrink-0 text-xs tabular-nums text-black/60 dark:text-white/60 @[12rem]:block">{share}</span>}
				{count !== null && <span className="min-w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{format.number(count)}</span>}
				{arrowSlot && (
					<span className="flex size-4 shrink-0">
						{arrow && <HugeiconsIcon icon={ArrowDown01Icon} className={twMerge("size-4", arrow === "closed" && "-rotate-90 rtl:rotate-90")} />}
					</span>
				)}
			</span>
			{count !== null && !heading && (
				<span aria-hidden className={twMerge("block h-1 overflow-hidden rounded-full bg-accent/10", arrowSlot && "mr-6 rtl:ml-6 rtl:mr-0")}>
					<span className="block h-full rounded-full bg-accent/70" style={{ width: barWidth(count, largest) }} />
				</span>
			)}
		</span>
	);
}
