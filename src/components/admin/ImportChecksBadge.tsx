"use client";

import { useId, useRef, useState } from "react";
import { FreeSoloPopover } from "@nextui-org/react";
import { CheckListIcon, Pdf01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, useReducedMotion } from "framer-motion";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import useBreakpoint from "@/hooks/useBreakpoint";
import { HOVER_CARD_CLOSE_DELAY, HOVER_CARD_DELAY, Tooltip } from "@/components/nextui/Tooltip";
import type { AdminItemChecks } from "@/lib/admin/types";

import { CheckMeter, Checks } from "./ImportReview";
import { checkPasses, heldChecks } from "./admin-import";

// How the badge reads: every check met, some, or none.
function toneOf(passed: number, count: number) {
	if (passed === count) return "text-emerald-700 dark:text-emerald-400";
	return passed ? "text-amber-700 dark:text-amber-400" : "text-danger";
}

const readOn = (at: string) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const CARD = "w-[380px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-black/10 bg-card_light p-0 shadow-xl dark:border-white/10 dark:bg-card";
// Where the table and the record sit side by side, out to the left of the record sidebar, beside the table, so it covers
// nothing being edited; the badge sits 20 px in from the sidebar's edge. With one pane at a time there is no room
// beside it, and below the badge the card is kept inside the window.
const BESIDE = { offset: 32, placement: "left-start" } as const;
const BELOW = { offset: 8, placement: "bottom-start" } as const;

/**
 * The AI checks a record's PDF was read against when a PDF import made it, as
 * a badge on the top left of its cover, the whole list on hover. A press pins
 * the list open, as a touch screen has no hover. Only a record whose PDF is
 * still the one that was read has one.
 */
export function ImportChecksBadge({ checks: stored, payload }: { checks: AdminItemChecks | null | undefined; payload: Record<string, unknown> }) {
	const reduceMotion = useReducedMotion();
	const [hovered, setHovered] = useState(false);
	const [pinned, setPinned] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null!);
	const cardId = useId();
	// The workbench puts its panes side by side from xl.
	const place = useBreakpoint("xl") ? BESIDE : BELOW;
	if (!stored?.checks.length) return null;
	const checks = heldChecks(stored, payload);
	const passed = checks.filter(checkPasses).length;
	const content = <ChecksCard checks={checks} stored={stored} />;
	return (
		<>
			<Tooltip
				className={CARD}
				closeDelay={HOVER_CARD_CLOSE_DELAY}
				color="default"
				content={content}
				delay={HOVER_CARD_DELAY}
				disableAnimation={Boolean(reduceMotion)}
				isDisabled={pinned}
				isOpen={hovered && !pinned}
				onOpenChange={setHovered}
				// A keyboard opens the card with a press, as a touch screen does; on focus it would come back after Escape.
				openOnFocus={false}
				{...place}
			>
				<button
					ref={trigger}
					aria-controls={pinned ? cardId : undefined}
					aria-expanded={pinned}
					aria-haspopup="dialog"
					aria-label={`AI checks: ${passed} of ${checks.length} pass`}
					className={`absolute left-1 top-1 z-10 inline-flex h-5 items-center gap-1 rounded-full bg-white/95 px-1.5 text-[10px] font-semibold tabular-nums shadow-sm ring-1 ring-black/10 backdrop-blur-sm focus-visible:outline-focus dark:bg-black/70 dark:ring-white/15 ${toneOf(passed, checks.length)}`}
					onClick={() => {
						setHovered(false);
						setPinned((open) => !open);
					}}
					// Focus stays on the badge, so Escape closes the pinned card from here.
					onKeyDown={(event) => {
						if (event.key === "Escape" && pinned) setPinned(false);
					}}
					type="button"
				>
					<HugeiconsIcon aria-hidden icon={CheckListIcon} size={11} />
					{passed}/{checks.length}
				</button>
			</Tooltip>
			<AnimatePresence>
				{pinned ? (
					<FreeSoloPopover
						aria-label="AI checks"
						classNames={{ base: "max-h-[inherit]", content: `${CARD} max-h-[inherit]` }}
						disableAnimation={Boolean(reduceMotion)}
						id={cardId}
						isOpen
						onOpenChange={setPinned}
						shouldBlockScroll={false}
						triggerRef={trigger}
						{...place}
					>
						{content}
					</FreeSoloPopover>
				) : null}
			</AnimatePresence>
		</>
	);
}

/** The checks list itself: the meter, the PDF they were read from and when, then each check. */
function ChecksCard({ checks, stored }: { checks: ReturnType<typeof heldChecks>; stored: AdminItemChecks }) {
	return (
		// The card's width, not the filename's: the bubble centres its content, so a long name would widen it past the card.
		<div className="flex max-h-[min(70vh,560px)] w-full flex-col">
			<div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
				<p className="text-sm font-semibold text-black/90 dark:text-white/90">AI checks</p>
				<CheckMeter checks={checks} count={checks.length} />
			</div>
			{/* The PDF the checks were read from, and when. */}
			<div className="mx-4 mb-2 flex h-8 items-center gap-2 rounded-lg bg-black/[0.04] px-2.5 text-xs dark:bg-white/[0.06]">
				<HugeiconsIcon aria-hidden className="shrink-0 text-black/45 dark:text-white/45" icon={Pdf01Icon} size={14} />
				<span className="min-w-0 flex-1 truncate font-medium text-black/75 dark:text-white/75">{stored.filename}</span>
				<span className="shrink-0 tabular-nums text-black/45 dark:text-white/45">{readOn(stored.readAt)}</span>
			</div>
			<div className="min-h-0 overflow-y-auto px-4 pb-4 pt-1">
				<Checks checks={checks} />
			</div>
		</div>
	);
}
