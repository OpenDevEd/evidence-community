"use client";
import type { ReactNode } from "react";
import { SquareLock01Icon, PencilIcon, InboxIcon, RotateLeft01Icon, Tick01Icon, Comment01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import type { AdminReviewSnapshot } from "./admin-api";

export function ReviewVersionTabs({viewingSubmitted, onSelect}: {viewingSubmitted: boolean; onSelect: (submitted: boolean) => void}) {
  return (
		<div className="shrink-0">
			<div
				role="group"
				aria-label="Record version"
				className="flex border-b border-black/[0.06] dark:border-white/[0.07]"
			>
				{[false, true].map((value) => (
					<button
						key={String(value)}
						type="button"
						aria-pressed={viewingSubmitted === value}
						onClick={() => onSelect(value)}
						className={`relative flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 py-3 text-xs font-medium transition-background-text outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${viewingSubmitted === value ? "bg-black/[0.045] text-black/85 dark:bg-white/[0.045] dark:text-white/85" : "text-black/45 hover:text-black/70 dark:text-white/45"}`}
					>
						<HugeiconsIcon
							icon={value ? SquareLock01Icon : PencilIcon}
							size={14}
							aria-hidden
							className="shrink-0"
						/>
						{value ? "Submitted version" : "Working draft"}
					</button>
				))}
			</div>
		</div>);
}

const reviewStates = {
    pending: {label: "Awaiting review", icon: InboxIcon},
    published: {label: "Published version", icon: Tick01Icon},
    returned: {label: "Changes requested", icon: Comment01Icon},
    withdrawn: {label: "Withdrawn", icon: RotateLeft01Icon},
};
export function ReviewVersionNotice({snapshot, pending, canWithdraw, withdrawing, onWithdraw}: {
  snapshot: AdminReviewSnapshot; pending: boolean; canWithdraw: boolean; withdrawing: boolean; onWithdraw: () => void;
}) {
  return (
		<div className="mt-4 flex items-center gap-2.5">
			<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/[0.08] text-accent-700 dark:text-accent-300">
				<HugeiconsIcon icon={reviewStates[snapshot.reviewState].icon} size={16} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium text-black/75 dark:text-white/80">
					{reviewStates[snapshot.reviewState].label}
				</p>
				<p className="mt-0.5 text-[10px] text-black/45 dark:text-white/45">
					Submitted{" "}
					<time dateTime={snapshot.submittedAt}>
						{new Date(snapshot.submittedAt).toLocaleString(
							undefined,
							{
								month: "short",
								day: "numeric",
								hour: "numeric",
								minute: "2-digit",
							},
						)}
					</time>
				</p>
			</div>
			{pending && canWithdraw && (
				<Button
					size="xs"
					isDisabled={withdrawing}
					variant="transparent"
					className="h-8 min-w-0 shrink-0 gap-1.5 rounded-lg bg-black/[0.035] px-2.5 text-[11px] font-medium text-black/60 hover:bg-black/[0.07] dark:bg-white/[0.04] dark:text-white/65 dark:hover:bg-white/[0.08]"
					startContent={
						<HugeiconsIcon icon={RotateLeft01Icon} size={13} />
					}
                    onPress={onWithdraw}
				>
					Withdraw
				</Button>
			)}
		</div>);
}

export function ReviewDraftNotice({notice, conflictCount, onConflicts, feedback}: {
  notice: ReactNode; conflictCount: number; onConflicts: () => void; feedback: string | null | undefined;
}) {
  return (
		<>
			{notice}
 {conflictCount > 0 && <Button size="xs" variant="transparent" className="mt-3 h-8 w-full justify-between rounded-lg bg-amber-500/[0.07] px-3 text-amber-800 dark:text-amber-300" onPress={onConflicts}><span>{conflictCount} conflicts</span><span>Resolve →</span></Button>}
			{feedback && (
				<div className="mt-3 rounded-xl bg-amber-500/[0.07] p-3">
					<p className="text-xs font-medium text-amber-800 dark:text-amber-300">
						Changes requested
					</p>
					<p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-black/65 dark:text-white/65">
						{feedback}
					</p>
				</div>
			)}
		</>);
}
