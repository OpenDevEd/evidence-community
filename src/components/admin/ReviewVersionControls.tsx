"use client";
import { adminPanelTabState } from "./admin-tab-styles";
import { returnWordsFor, useReturnWords } from "./review-words";
import { useAdminSession } from "./AdminSessionProvider";
import type { ReactNode } from "react";
import {
	FileLockedIcon,
	Delete02Icon,
	Clock01Icon,
	FileEditIcon,
	InboxIcon,
	Undo02Icon,
	Tick01Icon,
	Comment01Icon,
	ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { RecordStateChip, reviewChip } from "./AdminStatus";
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
			<div role="group" aria-label="Record version" className="flex">
				{[false, true].map((value) => (
					<Tooltip
						key={String(value)}
						content="No version has been submitted yet"
						isDisabled={!value || hasSubmitted}
					>
						<span className="flex flex-1">
							<button
								type="button"
								aria-pressed={viewingSubmitted === value}
								disabled={value && !hasSubmitted}
								onClick={() => onSelect(value)}
								className={`disabled:cursor-not-allowed disabled:opacity-40 relative flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 py-3 text-xs sm:px-3 font-medium transition-background-text outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${adminPanelTabState(viewingSubmitted === value)}`}
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
						</span>
					</Tooltip>
				))}
			</div>
		</div>
	);
}

const reviewStates = {
	pending: {
		...reviewChip.pending,
		headerClassName:
			"bg-sky-100/80 text-sky-950 dark:bg-sky-500/[0.16] dark:text-sky-200",
	},
	published: {
		label: "Published",
		icon: Tick01Icon,
		className: "text-emerald-700 dark:text-emerald-300",
		headerClassName:
			"bg-emerald-100/80 text-emerald-950 dark:bg-emerald-500/[0.16] dark:text-emerald-200",
	},
	returned: {
		...reviewChip.returned,
		headerClassName:
			"bg-rose-100/80 text-rose-950 dark:bg-rose-500/[0.16] dark:text-rose-200",
	},
	withdrawn: {
		label: "Withdrawn",
		icon: Undo02Icon,
		className: "text-black/50 dark:text-white/50",
		headerClassName:
			"bg-black/[0.05] text-black/70 dark:bg-white/[0.08] dark:text-white/70",
	},
};

const deletedReviewState = {
	label: "Deleted",
	icon: Delete02Icon,
	headerClassName: reviewStates.withdrawn.headerClassName,
};

const notSubmittedReviewState = {
	label: "Not submitted",
	icon: FileEditIcon,
	headerClassName:
		"bg-amber-100/80 text-amber-950 dark:bg-amber-500/[0.16] dark:text-amber-200",
};

function reviewVersionTitle(
	detail: AdminItemDetail,
	viewingSubmitted: boolean,
) {
	if (viewingSubmitted) return "Submitted version";
	if (detail.state === "deleted") return "Deleted record";
	if (detail.draft) return "Working draft";
	return "Published version";
}

/**
 * On the working draft of a paper waiting for review, where the review is. Someone who can publish finds Publish and
 * Decline on its own version. A creator can do neither, so they are told where the answer comes instead.
 */
function waitingHere(snapshot: AdminReviewSnapshot | undefined, viewingSubmitted: boolean, canPublish: boolean) {
	if (viewingSubmitted || snapshot?.reviewState !== "pending") return null;
	return canPublish ? "Awaiting review: open Submitted version to publish or decline it" : "Waiting for an editor: the answer shows here";
}

function reviewVersionPresentation(
	detail: AdminItemDetail,
	snapshot: AdminReviewSnapshot | undefined,
	viewingSubmitted: boolean,
	canPublish: boolean,
) {
	const reviewState = selectedReviewState(
		detail.state,
		snapshot,
		viewingSubmitted,
	);
	const state = reviewState ?? recordReviewState(detail);

	return {
		dataState: reviewState ? snapshot?.reviewState : detail.state,
		state,
		stateLabel: reviewState ? (snapshot?.reviewState === "returned" ? returnWordsFor(detail).state : waitingHere(snapshot, viewingSubmitted, canPublish) ?? state.label) : recordReviewStateLabel(detail, state),
		title: reviewVersionTitle(detail, viewingSubmitted),
	};
}

function selectedReviewState(
	detailState: AdminItemDetail["state"],
	snapshot: AdminReviewSnapshot | undefined,
	viewingSubmitted: boolean,
) {
	if (!snapshot) return null;
	if (viewingSubmitted) return reviewStates[snapshot.reviewState];
	if (detailState === "deleted") return null;
	return reviewStates[snapshot.reviewState];
}

function recordReviewState(detail: AdminItemDetail) {
	if (detail.state === "deleted") return deletedReviewState;
	if (!detail.draft && detail.published) return reviewStates.published;
	return notSubmittedReviewState;
}

function recordReviewStateLabel(
	detail: AdminItemDetail,
	state: ReturnType<typeof recordReviewState>,
) {
	if (!detail.draft && detail.published && detail.state !== "deleted") {
		return `Revision ${detail.revision}`;
	}
	return state.label;
}

function formatReviewTime(value: string) {
	return new Date(value).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/** Who sent an added paper, as the review's time says it; one suggested from outside the team says so. */
function senderOf(snapshot: AdminReviewSnapshot | undefined) {
	if (!snapshot?.submittedByName) return "";
	return ` by ${snapshot.submittedByName}${snapshot.suggested ? ", outside the team" : ""}`;
}

function ReviewVersionTime({
	snapshot,
	updatedAt,
}: {
	snapshot?: AdminReviewSnapshot;
	updatedAt: string;
}) {
	const displayedAt = snapshot?.submittedAt ?? updatedAt;
	const by = senderOf(snapshot);
	const label = snapshot
		? `Submitted ${formatReviewTime(snapshot.submittedAt)}${by}`
		: `Edited ${formatReviewTime(updatedAt)}`;
	// It also shows a sender's name the bar cuts short.
	const explains = Boolean(snapshot) && (snapshot?.submittedAt !== updatedAt || Boolean(by));

	return (
		<Tooltip
			isDisabled={!explains}
			content={
				<div className="text-xs leading-5">
					<p>Last edited {formatReviewTime(updatedAt)}</p>
					{snapshot && (
						<p>Submitted {formatReviewTime(snapshot.submittedAt)}{by}</p>
					)}
				</div>
			}
		>
			<time
				tabIndex={explains ? 0 : undefined}
				dateTime={displayedAt}
				className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[10px] opacity-65 outline-none focus-visible:ring-2 focus-visible:ring-focus"
			>
				<HugeiconsIcon
					icon={Clock01Icon}
					size={11}
					className="shrink-0"
					aria-hidden
				/>
				<span className="truncate">{label}</span>
			</time>
		</Tooltip>
	);
}

function activeReviewState(
	snapshot: AdminReviewSnapshot | undefined,
	viewingSubmitted: boolean,
) {
	return snapshot &&
		(viewingSubmitted ||
			snapshot.reviewState === "pending" ||
			snapshot.reviewState === "returned")
		? reviewStates[snapshot.reviewState]
		: null;
}

export function ReviewStatusLabel({
	snapshot,
	detail,
	viewingSubmitted,
}: {
	snapshot?: AdminReviewSnapshot;
	detail: AdminItemDetail;
	viewingSubmitted: boolean;
}) {
	const state = activeReviewState(snapshot, viewingSubmitted);
	return state ? (
		<span className="inline-flex items-center gap-1.5">
			<HugeiconsIcon
				icon={state.icon}
				size={14}
				className={state.className}
			/>
			{state === reviewStates.returned ? returnWordsFor(detail).state : state.label}
		</span>
	) : (
		<RecordStateChip state={detail.state} />
	);
}

export function ReviewVersionNotice({
	detail,
	snapshot,
	updatedAt,
	viewingSubmitted,
}: {
	snapshot?: AdminReviewSnapshot;
	updatedAt: string;
	viewingSubmitted: boolean;
	detail: AdminItemDetail;
}) {
	const { canPublish } = useAdminSession();
	const { dataState, state, stateLabel, title } = reviewVersionPresentation(
		detail,
		snapshot,
		viewingSubmitted,
		canPublish,
	);
	return (
		<header
			data-admin-review-state={dataState}
			className={`shrink-0 px-4 py-3 ${state.headerClassName}`}
		>
			<h3 className="flex items-center gap-2 text-base font-semibold leading-6 tracking-tight">
				<HugeiconsIcon
					icon={state.icon}
					size={18}
					className="shrink-0"
					aria-hidden
				/>
				{title}
			</h3>
			<div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<p className="text-xs font-medium opacity-80">{stateLabel}</p>
				<ReviewVersionTime snapshot={snapshot} updatedAt={updatedAt} />
			</div>
		</header>
	);
}

export function ReviewWithdrawButton({
	submittedBy,
	withdrawing,
	onWithdraw,
	compact = false,
}: {
	submittedBy?: string;
	withdrawing: boolean;
	onWithdraw: () => void;
	/** Icon only, for when the bar also holds the publish and request-changes buttons. */
	compact?: boolean;
}) {
	const session = useAdminSession();
	const words = useReturnWords();
	const own = submittedBy === session.userId;
	// A paper someone sent is theirs to withdraw; the team declines it instead, with a reason they read.
	if (words.senderOnlyWithdraw && !own) return null;
	const canWithdraw = session.canPublish || own;
	const button = (
		<Button
			size="xs"
			variant="muted"
			aria-label="Withdraw"
			className={compact ? "h-9 w-9 shrink-0 rounded-xl px-0" : "h-9 shrink-0 rounded-xl px-3"}
			isIconOnly={compact}
			isDisabled={!canWithdraw || withdrawing}
			isLoading={withdrawing}
			onPress={onWithdraw}
			startContent={compact ? undefined : <HugeiconsIcon icon={Undo02Icon} size={14} />}
		>
			{compact ? <HugeiconsIcon icon={Undo02Icon} size={14} /> : "Withdraw"}
		</Button>
	);
	return compact ? <Tooltip content="Withdraw"><span>{button}</span></Tooltip> : button;
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
	const words = useReturnWords();
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
					<p className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-300">
						<HugeiconsIcon icon={Comment01Icon} size={14} />
						{words.state}
					</p>
					<p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-black/65 dark:text-white/65">
						{feedback}
					</p>
				</div>
			)}
		</>
	);
}
