"use client";

import { useId } from "react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Link } from "@/i18n/routing";
import { twMerge } from "@/lib/tw-merge";

const MUTED = "text-black/60 dark:text-white/60";

/** The sidebar's grey: the filter card's, and every card's head and foot, so the column reads as one set. */
export const SIDEBAR_GREY = "bg-secondary_light dark:bg-secondary";

/**
 * A block of the sidebar, built as the filter card is: a grey head with the heading and a summary of the block and its
 * content on white. A block with actions keeps them in a grey foot instead, under a white head.
 */
export function SidebarCard({ title, aside, footer, link, band, children, ref }: { title: React.ReactNode; aside?: React.ReactNode; footer?: React.ReactNode; link?: { href: string; label: string }; /** A summary of what is below, under the heading in the card's head. */ band?: React.ReactNode; children: React.ReactNode; ref?: React.Ref<HTMLElement> }) {
	// One grey per card: a card with actions keeps its grey for the foot that holds them, and its head stays white.
	const hasFoot = Boolean(footer || link);
	const id = useId();
	return (
		// Square on a phone, where the Explore sheet runs every card edge to edge, as the filter card does.
		<section ref={ref} aria-labelledby={id} className="w-full bg-card_light sm:rounded-2xl dark:bg-card">
			<div className={twMerge("flex flex-col gap-4 px-6 py-5 sm:rounded-t-2xl", !hasFoot && SIDEBAR_GREY)}>
				<div className="flex min-h-8 items-center justify-between gap-4">
					<h4 id={id} className="font-heading text-xl font-medium text-black dark:text-white/80">{title}</h4>
					{aside}
				</div>
				{band}
			</div>
			<div className={twMerge("flex flex-col gap-5 p-6", hasFoot && "pt-1")}>{children}</div>
			{hasFoot && (
				<div className={twMerge("flex justify-end gap-2 p-2 sm:rounded-b-2xl", SIDEBAR_GREY)}>
					{footer}
					{link && (
						<Button as={Link} role="link" href={link.href} size="sm" endContent={<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="size-3.5" />}>
							{link.label}
						</Button>
					)}
				</div>
			)}
		</section>
	);
}

/** A large figure and what it counts, for a card's head. */
export function HeadFigure({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
	return (
		<p className="flex items-baseline gap-2" aria-live="polite">
			<span className="font-heading text-3xl font-semibold leading-none tabular-nums">{value}</span>
			<span className={`text-sm ${MUTED}`}>{label}</span>
		</p>
	);
}

/** A bar's width for a count against the largest: a sliver at least for any count, nothing for none. */
export function barWidth(count: number, largest: number) {
	return count > 0 ? `${Math.max(2, (count / largest) * 100)}%` : "0%";
}
