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
	UserAdd01Icon,
	Copy01Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { ReaderAvatar } from "@/components/layout/navbar/UserMenu";
import { TruncatedText } from "@/components/nextui/TruncatedText";
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
	if (detail.state === "deleted") return detail.withdrawn ? { ...deletedReviewState, label: "Withdrawn" } : deletedReviewState;
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

/** Copies the sender's email, as the item key's button copies the key. */
function CopyEmail({ email }: { email: string }) {
	return (
		<Tooltip content="Copy email">
			<Button
				aria-label={`Copy email ${email}`}
				variant="transparent"
				size="xs"
				isIconOnly
				className="-my-1 size-6 min-w-0 shrink-0 rounded-md text-current opacity-50 hover:opacity-90"
				onPress={() => {
					void navigator.clipboard
						.writeText(email)
						.then(() => toast.success("Email copied"))
						.catch(() => toast.error("Could not copy email"));
				}}
			>
				<HugeiconsIcon icon={Copy01Icon} size={12} aria-hidden />
			</Button>
		</Tooltip>
	);
}

/** Who sent the version, with their photo, their email for an Editor or Owner, whether they're outside the team, and when. */
function ReviewSender({ snapshot, editedAt }: { snapshot: AdminReviewSnapshot; editedAt: string | null }) {
	const email = snapshot.submittedByEmail;
	// An Openscholar account may have no name: the avatar then shows a person, and the row says Reader as the library does.
	const name = snapshot.submittedByName ?? "";
	return (
		<div className="mt-3 flex min-w-0 items-start gap-3 rounded-xl bg-white/70 p-2.5 dark:bg-black/20">
			<ReaderAvatar reader={{ id: snapshot.submittedBy, name, image: snapshot.submittedByImage }} size="md" className="self-start" />
			<div className="min-w-0 flex-1">
				<TruncatedText text={name || "Reader"} className="block text-sm font-semibold leading-5" />
				{email && (
					<div className="flex min-w-0 items-center gap-0.5">
						<TruncatedText text={email} className="block min-w-0 text-xs leading-4 opacity-70" />
						<CopyEmail email={email} />
					</div>
				)}
				<div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] leading-4">
					{snapshot.suggested && (
						<span className="inline-flex h-5 items-center gap-1 rounded-full bg-sky-200/70 px-2 font-medium text-sky-900 dark:bg-sky-400/20 dark:text-sky-100">
							<HugeiconsIcon icon={UserAdd01Icon} size={12} aria-hidden />
							Outside the team
						</span>
					)}
					<span className="inline-flex items-center gap-1 opacity-70">
						<HugeiconsIcon icon={Clock01Icon} size={12} aria-hidden />
						<time dateTime={snapshot.submittedAt}>Sent {formatReviewTime(snapshot.submittedAt)}</time>
					</span>
					{editedAt && (
						<span className="inline-flex items-center gap-1 opacity-70">
							<HugeiconsIcon icon={FileEditIcon} size={12} aria-hidden />
							<time dateTime={editedAt}>Draft edited {formatReviewTime(editedAt)}</time>
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

function ReviewVersionTime({
	snapshot,
	updatedAt,
}: {
	snapshot?: AdminReviewSnapshot;
	updatedAt: string;
}) {
	const displayedAt = snapshot?.submittedAt ?? updatedAt;
	const label = snapshot
		? `Submitted ${formatReviewTime(snapshot.submittedAt)}`
		: `Edited ${formatReviewTime(updatedAt)}`;
	const explains = Boolean(snapshot) && snapshot?.submittedAt !== updatedAt;

	return (
		<Tooltip
			isDisabled={!explains}
			content={
				<div className="text-xs leading-5">
					<p>Last edited {formatReviewTime(updatedAt)}</p>
					{snapshot && (
						<p>Submitted {formatReviewTime(snapshot.submittedAt)}</p>
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
		<RecordStateChip state={detail.state} withdrawn={detail.withdrawn} />
	);
}

/** Whether the library knows anything of the sender to show: a name, a photo or, for an Editor or Owner, an email. */
const knowsSender = (snapshot: AdminReviewSnapshot) => Boolean(snapshot.submittedByName || snapshot.submittedByImage || snapshot.submittedByEmail);

/** When the working draft was saved after the version waiting for review was sent; sending saves the draft first. */
function draftEditedAt(detail: AdminItemDetail, snapshot: AdminReviewSnapshot, viewingSubmitted: boolean) {
	if (viewingSubmitted || snapshot.reviewState !== "pending" || !detail.draft) return null;
	return Date.parse(detail.draft.updatedAt) > Date.parse(snapshot.submittedAt) ? detail.draft.updatedAt : null;
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
			{snapshot && knowsSender(snapshot) ? (
				<>
					<p className="mt-0.5 text-xs font-medium opacity-80">{stateLabel}</p>
					<ReviewSender snapshot={snapshot} editedAt={draftEditedAt(detail, snapshot, viewingSubmitted)} />
				</>
			) : (
				<div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					<p className="text-xs font-medium opacity-80">{stateLabel}</p>
					<ReviewVersionTime snapshot={snapshot} updatedAt={updatedAt} />
				</div>
			)}
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

/** What a working draft's review says beyond its band: conflicts to resolve, and the editor's note when it came back. */
export function ReviewDraftNotice({
	conflictCount,
	onConflicts,
	feedback,
}: {
	conflictCount: number;
	onConflicts: () => void;
	feedback: string | null | undefined;
}) {
	const words = useReturnWords();
	if (conflictCount === 0 && !feedback) return null;
	return (
		<div className="grid gap-3">
			{conflictCount > 0 && (
				<Button
					size="xs"
					variant="transparent"
					className="h-8 w-full justify-between rounded-lg bg-amber-500/[0.07] px-3 text-amber-800 dark:text-amber-300"
					onPress={onConflicts}
				>
					<span>{conflictCount} conflicts</span>
					<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
				</Button>
			)}
			{feedback && (
				<div className="rounded-xl bg-amber-500/[0.07] p-3">
					<p className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-300">
						<HugeiconsIcon icon={Comment01Icon} size={14} />
						{words.state}
					</p>
					<p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-black/65 dark:text-white/65">
						{feedback}
					</p>
				</div>
			)}
		</div>
	);
}
