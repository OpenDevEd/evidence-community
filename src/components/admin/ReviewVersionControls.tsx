"use client";
import { useAdminSession } from "./AdminSessionProvider";
import type { ReactNode } from "react";
import {
	FileLockedIcon,
	FileEditIcon,
	PencilIcon,
	InboxIcon,
	RotateLeft01Icon,
	Tick01Icon,
	Comment01Icon,
	ArrowRight01Icon,
	Clock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { RecordStateChip } from "./AdminStatus";
import type { AdminItemDetail } from "@/lib/admin/types";
import type { AdminReviewSnapshot } from "./admin-api";

export function ReviewVersionTabs({
	viewingSubmitted,
	hasSubmitted,
	onSelect,
}: {
	viewingSubmitted: boolean;
	hasSubmitted: boolean;
	onSelect: (submitted: boolean) => void;
}) {
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
						disabled={value && !hasSubmitted}
						title={
							value && !hasSubmitted
								? "No version has been submitted yet"
								: undefined
						}
						onClick={() => onSelect(value)}
						className={`disabled:cursor-not-allowed disabled:opacity-40 relative flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 py-3 text-xs sm:px-3 font-medium transition-background-text outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${viewingSubmitted === value ? "bg-black/[0.045] text-black/85 dark:bg-white/[0.045] dark:text-white/85" : "text-black/45 hover:text-black/70 dark:text-white/45"}`}
					>
						<HugeiconsIcon
							icon={value ? FileLockedIcon : FileEditIcon}
							size={18}
							strokeWidth={1.8}
							aria-hidden
							className="shrink-0"
						/>
						{value ? "Submitted version" : "Working draft"}
					</button>
				))}
			</div>
		</div>
	);
}

const reviewStates = {
	pending: { label: "Awaiting review", icon: InboxIcon },
	published: { label: "Published version", icon: Tick01Icon },
	returned: { label: "Changes requested", icon: Comment01Icon },
	withdrawn: { label: "Withdrawn", icon: RotateLeft01Icon },
};
export function ReviewStatusLabel({
	snapshot,
	detail,
	viewingSubmitted,
}: {
	snapshot?: AdminReviewSnapshot;
	detail: AdminItemDetail;
	viewingSubmitted: boolean;
}) {
	const state =
		snapshot &&
		(viewingSubmitted ||
			snapshot.reviewState === "pending" ||
			snapshot.reviewState === "returned")
			? reviewStates[snapshot.reviewState]
			: null;
	return state ? (
		<span className="inline-flex items-center gap-1.5">
			<HugeiconsIcon
				icon={state.icon}
				size={14}
				className="text-accent-300 dark:text-accent-700"
			/>
			{state.label}
		</span>
	) : (
		<RecordStateChip state={detail.state} />
	);
}

export function ReviewVersionNotice({
	snapshot,
	updatedAt,
	viewingSubmitted,
	onViewSubmitted,
	actions,
}: {
	snapshot?: AdminReviewSnapshot;
	updatedAt: string;
	viewingSubmitted: boolean;
	onViewSubmitted: () => void;
	actions: ReactNode;
}) {
	const state = snapshot
		? reviewStates[snapshot.reviewState]
		: { label: "Not submitted", icon: PencilIcon };
	const timestamp = snapshot?.submittedAt ?? updatedAt;
	return (
		<>
			<h3 className="text-sm font-semibold text-black/80 dark:text-white/85">
				{state.label}
			</h3>
			<div className="mt-3 flex items-center gap-2 text-[10px] text-black/45 dark:text-white/45">
				<HugeiconsIcon icon={Clock01Icon} size={14} />
				<time dateTime={timestamp}>
					{snapshot ? "Submitted" : "Edited"}{" "}
					{new Date(timestamp).toLocaleString(undefined, {
						month: "short",
						day: "numeric",
						hour: "numeric",
						minute: "2-digit",
					})}
				</time>
			</div>
			<div className="mt-4 flex items-center gap-2 empty:hidden">
				{!viewingSubmitted && (
					<Button
						size="xs"
						variant="muted"
						className="h-9 min-w-0 flex-1 justify-between rounded-xl"
						isDisabled={!snapshot || viewingSubmitted}
						onPress={onViewSubmitted}
						endContent={
							<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
						}
					>
						View submitted version
					</Button>
				)}
				{actions}
			</div>
		</>
	);
}

export function ReviewWithdrawButton({
	pending,
	submittedBy,
	withdrawing,
	onWithdraw,
}: {
	pending: boolean;
	submittedBy?: string;
	withdrawing: boolean;
	onWithdraw: () => void;
}) {
	const session = useAdminSession();
	const canWithdraw =
		session.canPublish || submittedBy === session.userId;
	return (
		<Button
			size="xs"
			variant="muted"
			className="h-9 shrink-0 rounded-xl px-3"
			isDisabled={!pending || !canWithdraw || withdrawing}
			isLoading={withdrawing}
			onPress={onWithdraw}
			startContent={<HugeiconsIcon icon={RotateLeft01Icon} size={14} />}
		>
			Withdraw
		</Button>
	);
}

export function ReviewDraftNotice({
	notice,
	conflictCount,
	onConflicts,
	feedback,
}: {
	notice: ReactNode;
	conflictCount: number;
	onConflicts: () => void;
	feedback: string | null | undefined;
}) {
	return (
		<>
			{notice}
			{conflictCount > 0 && (
				<Button
					size="xs"
					variant="transparent"
					className="mt-3 h-8 w-full justify-between rounded-lg bg-amber-500/[0.07] px-3 text-amber-800 dark:text-amber-300"
					onPress={onConflicts}
				>
					<span>{conflictCount} conflicts</span>
					<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
				</Button>
			)}
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
		</>
	);
}
