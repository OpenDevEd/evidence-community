"use client";

import { CheckListIcon, Pdf01Icon } from "@hugeicons/core-free-icons";
import { useReducedMotion } from "framer-motion";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
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

/**
 * The AI checks a record's PDF was read against when a PDF import made it, as
 * a badge on the top left of its cover, the whole list on hover. Only a record
 * whose PDF is still the one that was read has one.
 */
export function ImportChecksBadge({ checks: stored, payload }: { checks: AdminItemChecks | null | undefined; payload: Record<string, unknown> }) {
	const reduceMotion = useReducedMotion();
	if (!stored?.checks.length) return null;
	const checks = heldChecks(stored, payload);
	const passed = checks.filter(checkPasses).length;
	return (
		<Tooltip
			className="w-[380px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-black/10 bg-card_light p-0 shadow-xl dark:border-white/10 dark:bg-card"
			closeDelay={HOVER_CARD_CLOSE_DELAY}
			color="default"
			content={
				<div className="flex max-h-[min(70vh,560px)] flex-col">
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
			}
			delay={HOVER_CARD_DELAY}
			disableAnimation={Boolean(reduceMotion)}
			offset={10}
			placement="bottom-start"
		>
			<button
				aria-label={`AI checks: ${passed} of ${checks.length} pass`}
				className={`absolute left-1 top-1 z-10 inline-flex h-5 items-center gap-1 rounded-full bg-white/95 px-1.5 text-[10px] font-semibold tabular-nums shadow-sm ring-1 ring-black/10 backdrop-blur-sm focus-visible:outline-focus dark:bg-black/70 dark:ring-white/15 ${toneOf(passed, checks.length)}`}
				type="button"
			>
				<HugeiconsIcon aria-hidden icon={CheckListIcon} size={11} />
				{passed}/{checks.length}
			</button>
		</Tooltip>
	);
}
