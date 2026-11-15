"use client";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import type { ComponentProps, ReactNode } from "react";
import useSWR from "swr";
import { ReturnWordsContext, returnWordsFor } from "./review-words";
import { getAdminItem, adminErrorMessage } from "./admin-api";
import type { ConflictingDraft } from "@/lib/admin/errors";
import type { AdminReviewSnapshot } from "./admin-api";
import { AdminInspector } from "./AdminInspector";
import { usePublishingChoice } from "./usePublishingChoice";
import { useItemReview } from "./useItemReview";
import { useReviewVersion } from "./useReviewVersion";
import { useReviewDraftConflicts } from "./useReviewDraftConflicts";
import { useAdminSession } from "./AdminSessionProvider";
import { useReviewCorrections } from "./useReviewCorrections";
import {
	useReviewLinkPicker,
	type ReviewLinkPicker,
} from "./useReviewLinkPicker";
import type { AdminItemDetail, AdminItemLinkKind } from "@/lib/admin/types";
import { DraftConflict } from "./DraftConflict";
import { ReviewActions } from "./ReviewActions";
import { ReviewReadiness, useReviewReadiness } from "./ReviewReadiness";
import {
	ReviewVersionTabs,
	ReviewVersionNotice,
	ReviewStatusLabel,
	ReviewWithdrawButton,
	ReviewDraftNotice,
} from "./ReviewVersionControls";

type Props = ComponentProps<typeof AdminInspector> & {
	concurrentConflict?: ConflictingDraft;
	onResolveConcurrentConflict: (
		choices: Record<string, "draft" | "published">,
	) => void;
	reviewQueue: boolean;
	onStartReviewLinkPick: (
		kind: AdminItemLinkKind,
		picker: ReviewLinkPicker,
	) => void;
};

export function EditorialInspector(props: Props) {
	if (!props.detail) return <AdminInspector {...props} />;
	return (
		// An added paper is declined, not sent back for changes its sender can't make.
		<ReturnWordsContext value={returnWordsFor(props.detail)}>
			<ReviewInspector
				key={`${props.detail.key}:${props.reviewQueue}`}
				{...props}
				detail={props.detail}
			/>
		</ReturnWordsContext>
	);
}

/** Withdraw shares the action bar with publish and request-changes (or Decline) only for a publisher on a pending submitted version. */
function withdrawCompact(viewingSubmitted: boolean, pending: boolean, canPublish: boolean) {
	return viewingSubmitted && pending && canPublish;
}

function returnedReviewNote(snapshot: AdminReviewSnapshot | undefined) {
	return snapshot?.reviewState === "returned" ? snapshot.note : null;
}

function ReviewInspector(props: Props & { detail: AdminItemDetail }) {
	const model = useReviewInspector(props);
	const { snapshot, pending, version, viewingSubmitted, frozenDetail } =
		model;
	const controls = (
		<ReviewVersionTabs
			viewingSubmitted={viewingSubmitted}
			hasSubmitted={Boolean(snapshot)}
			onSelect={version.selectVersion}
		/>
	);
	const notice = (
		<ReviewVersionNotice
			detail={props.detail}
			snapshot={snapshot}
			updatedAt={props.detail.draft?.updatedAt ?? props.detail.updatedAt}
			viewingSubmitted={viewingSubmitted}
		/>
	);
	const header = {
		liveDetail: props.detail,
		versionStatus: (
			<ReviewStatusLabel
				snapshot={snapshot}
				detail={props.detail}
				viewingSubmitted={viewingSubmitted}
			/>
		),
		// Withdraw is there only while a review it can take back is pending.
		versionWithdraw: pending ? (
			<ReviewWithdrawButton
				submittedBy={snapshot?.submittedBy}
				withdrawing={version.withdrawing}
				onWithdraw={version.withdraw}
				compact={model.withdrawCompact}
			/>
		) : null,
		actionsReady: !model.reviewLoading,
		reviewId: snapshot?.reviewId,
	};

	if (!viewingSubmitted || !frozenDetail || !snapshot) {
		return (
			<WorkingDraftInspector
				{...props}
				{...header}
				model={model}
				controls={controls}
				notice={notice}
			/>
		);
	}
	return (
		<SubmittedInspector
			{...props}
			{...header}
			model={model}
			snapshot={snapshot}
			frozenDetail={frozenDetail}
			controls={controls}
			notice={notice}
		/>
	);
}

type VersionInspectorProps = Props & {
	detail: AdminItemDetail;
	model: ReturnType<typeof useReviewInspector>;
	controls: ReactNode;
	notice: ReactNode;
};

/**
 * Why the working draft can't be submitted yet: a conflict, readiness still loading or missing, or the record's
 * review pending, though this attachment isn't in it (it can't be submitted, but it can be deleted).
 */
function submissionBlocked(
	hasConflict: boolean,
	readiness: { loading: boolean; saving: boolean; missing: number },
	recordReviewPending: boolean,
) {
	return hasConflict || readiness.loading || readiness.saving || readiness.missing > 0 || recordReviewPending;
}

/** A Zotero PDF change has no draft to delete, so the record's review blocks it as its own would. */
function draftReviewPending(pending: boolean, recordReviewPending: boolean, hasDraft: boolean) {
	return pending || (recordReviewPending && !hasDraft);
}

function WorkingDraftInspector({
	model,
	controls,
	notice,
	...props
}: VersionInspectorProps) {
	const { snapshot, pending, error, conflicts } = model;
	const fields = conflicts.fields;
	const hasConflict = fields.length > 0;
	const readiness = useReviewReadiness(
		props.detail,
		props.payload,
		model.publishing,
	);
	const draftNotice = (
		<ReviewDraftNotice
			conflictCount={props.concurrentConflict ? 0 : fields.length}
			feedback={returnedReviewNote(snapshot)}
			onConflicts={conflicts.focus}
		/>
	);

	return (
		<AdminInspector
			{...props}
			conflictCount={props.concurrentConflict ? fields.length : 0}
			onResolveConflicts={
				props.concurrentConflict ? conflicts.focus : undefined
			}
			publishing={model.publishing}
			error={error instanceof Error ? error.message : props.error}
			versionControls={controls}
			versionBand={notice}
			versionNotice={draftNotice}
			editorNotice={
				<WorkingDraftNotices
					model={model}
					props={props}
					readiness={readiness}
				/>
			}
			submissionBlocked={submissionBlocked(hasConflict, readiness, model.recordReviewPending)}
			reviewPending={draftReviewPending(pending, model.recordReviewPending, Boolean(props.detail.draft))}
		/>
	);
}

function useSubmittedLiveDetail(
	detail: AdminItemDetail,
	frozen: AdminItemDetail,
	onRetry: (() => void) | undefined,
) {
	const needsLiveDetail = frozen.key !== detail.key;
	const request = useSWR(
		needsLiveDetail ? ["admin-review-live-item", frozen.key] : null,
		([, key]) => getAdminItem(key),
	);
	const liveDetail = needsLiveDetail ? request.data : detail;
	return {
		detail: liveDetail ? frozen : null,
		liveDetail,
		loading: needsLiveDetail && request.isLoading,
		error: request.error
			? adminErrorMessage(
					request.error,
					"Could not load the attachment status",
				)
			: null,
		onRetry: needsLiveDetail ? () => void request.mutate() : onRetry,
	};
}

function SubmittedInspector({
	model,
	controls,
	notice,
	snapshot,
	frozenDetail,
	...props
}: VersionInspectorProps & {
	snapshot: AdminReviewSnapshot;
	frozenDetail: NonNullable<
		ReturnType<typeof useReviewVersion>["frozenDetail"]
	>;
}) {
	const {
		pending,
		session,
		corrections,
		changed,
		reviewPayload,
		startReviewLinkPick,
		version,
	} = model;

	const live = useSubmittedLiveDetail(
		props.detail,
		frozenDetail,
		props.onRetry,
	);

	const readiness = useReviewReadiness(
		frozenDetail,
		reviewPayload,
		model.publishing,
		snapshot.publishing,
	);
	const allowCorrections = pending && session.canPublish;
	const saveState = corrections.saving ? "saving" : "saved";
	const checks = submittedChecks(snapshot, frozenDetail, corrections.payloads, readiness);
	const reviewActions = (
		<ReviewActions
			snapshot={snapshot}
			disabled={corrections.saving || Boolean(corrections.error)}
			publishBlocked={checks.publishBlocked}
			onUpdated={changed}
		/>
	);
	return (
		<AdminInspector
			{...props}
			publishing={model.publishing}
			detail={live.detail}
			liveDetail={live.liveDetail}
			payload={reviewPayload}
			previewReview={{ id: snapshot.reviewId, itemKey: snapshot.key, revision: snapshot.reviewRevision }}
			readOnlyVersion
			allowReviewCorrections={allowCorrections}
			publishingChoice={snapshot.publishing}
			onChange={(payload) =>
				corrections.change(frozenDetail.key, payload)
			}
			versionActions={
				allowCorrections ? reviewActions : undefined
			}
			editorNotice={
				<SubmittedNotice
					pending={pending}
					frozenDetail={frozenDetail}
					readiness={checks.shown}
					reviewActions={reviewActions}
				/>
			}
			versionControls={controls}
			versionBand={notice}
			linkTargets={[
				...(props.linkTargets ?? []),
				...frozenDetail.links.targets,
			]}
			onStartLinkPick={startReviewLinkPick}
			fileErrors={{}}
			validationErrors={{}}
			validationRevision={0}
			loading={live.loading}
			error={live.error ?? corrections.error}
			onRetry={live.onRetry}
			saveMessage={corrections.error}
			saveState={corrections.error ? "error" : saveState}
			onSelectAttachment={version.selectAttachment}
			onBackToParent={version.backToParent}
		/>
	);
}

function useReviewInspector(props: Props & { detail: AdminItemDetail }) {
	const publishing = usePublishingChoice(props.detail, false, props.preview.onRefresh);
	const key = props.detail.key;
	const review = useItemReview(props.detail.parentItem ?? props.detail.key);
	const { refresh, error } = review;
	const snapshot =
		review.snapshot &&
		(review.snapshot.key === key ||
			review.snapshot.frozenAttachments.some(
				(attachment) => attachment.key === key,
			))
			? review.snapshot
			: undefined;
	const pending = Boolean(snapshot && review.pending);
	const session = useAdminSession();
	const corrections = useReviewCorrections(snapshot, refresh);
	const changed = (receipts?: readonly AdminSearchIndexReceipt[]) => {
		props.onStopLinkPick?.();
		void refresh();
		return props.onPublicationChanged(receipts);
	};
	const { ref: conflictRef, ...conflicts } = useReviewDraftConflicts(
		snapshot,
		props.detail,
		changed,
	);
	const version = useReviewVersion(snapshot, {
		initialSubmitted: props.reviewQueue,
		itemKey: key,
		onChanged: changed,
		onStopLinkPick: props.onStopLinkPick,
		onBackToParent: props.onBackToParent,
	});
	const { viewingSubmitted, frozenDetail } = version;
	const reviewPayload = frozenDetail
		? (corrections.payloads[frozenDetail.key] ?? frozenDetail.draft.payload)
		: {};
	const startReviewLinkPick = useReviewLinkPicker({
		detail: frozenDetail,
		payload: reviewPayload,
		change: corrections.change,
		enabled: Boolean(pending) && session.canPublish,
		onStart: props.onStartReviewLinkPick,
	});
	return {
		publishing,
		snapshot,
		pending,
		// The record's review is pending, though an attachment added after it isn't in its snapshot.
		recordReviewPending: Boolean(review.pending),
		reviewLoading: review.loading,
		error,
		session,
		withdrawCompact: withdrawCompact(viewingSubmitted, pending, session.canPublish),
		corrections,
		changed,
		conflictRef,
		conflicts: {
			...conflicts,
			fields: workingConflictFields(props, conflicts.fields),
		},
		version,
		viewingSubmitted,
		frozenDetail,
		reviewPayload,
		startReviewLinkPick,
	};
}

function workingConflictFields(props: Props, reviewFields: string[]) {
	return props.concurrentConflict
		? Object.keys(props.validationErrors ?? {})
		: reviewFields;
}

type WorkingDraftNoticeProps = {
	model: VersionInspectorProps["model"];
	props: Omit<VersionInspectorProps, "model" | "controls" | "notice">;
};

function WorkingDraftNotices({
	model,
	props,
	readiness,
}: WorkingDraftNoticeProps & {
	readiness: ReturnType<typeof useReviewReadiness>;
}) {
	const requirements =
		props.detail.parentItem || !props.detail.draft ? null : (
			<ReviewReadiness
				recordKey={props.detail.key}
				readiness={readiness}
				requestedChanges={returnedReviewNote(model.snapshot)}
			/>
		);
	if (model.conflicts.fields.length > 0)
		return (
			<>
				<WorkingDraftConflict
					model={model}
					props={props}
					disabled={
						props.busy ||
						model.conflicts.resolving ||
						props.saveState === "saving"
					}
				/>
				{readiness.missing > 0 && requirements}
			</>
		);
	return props.saveState === "conflict" ? null : requirements;
}

function WorkingDraftConflict({
	model,
	props,
	disabled,
}: WorkingDraftNoticeProps & { disabled: boolean }) {
	const { snapshot, conflicts, conflictRef } = model;
	const concurrent = props.concurrentConflict;
	const version = concurrent ?? props.detail.draft;
	return (
		<div
			ref={conflictRef}
			tabIndex={-1}
			className="mb-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-focus"
		>
			<DraftConflict
				key={`${snapshot?.reviewRevision}:${version?.draftRevision}`}
				source={concurrent ? "session" : "published"}
				payload={props.payload}
				published={concurrent?.payload ?? props.detail.published ?? {}}
				conflictFields={conflicts.fields}
				disabled={disabled}
				onResolve={
					concurrent
						? props.onResolveConcurrentConflict
						: conflicts.resolve
				}
			/>
		</div>
	);
}

/** A submitted record's checks: they gate publishing, unless the review only shows the record, uncorrected. */
function submittedChecks(
	snapshot: AdminReviewSnapshot,
	frozenDetail: AdminItemDetail,
	corrected: Record<string, unknown>,
	readiness: ReturnType<typeof useReviewReadiness>,
) {
	const onlyShown = snapshot.unchangedKeys.includes(frozenDetail.key) && !corrected[frozenDetail.key];
	return {
		publishBlocked: !frozenDetail.parentItem && !onlyShown && readiness.missing > 0,
		shown: onlyShown ? null : readiness,
	};
}

function SubmittedNotice({
	pending,
	frozenDetail,
	readiness,
	reviewActions,
}: {
	pending: boolean;
	frozenDetail: AdminItemDetail;
	readiness: ReturnType<typeof useReviewReadiness> | null;
	reviewActions: ReactNode;
}) {
	return (
		<>
			{pending && !frozenDetail.parentItem && readiness ? (
				<ReviewReadiness
					recordKey={frozenDetail.key}
					readiness={readiness}
				/>
			) : !pending ? (
				reviewActions
			) : undefined}
		</>
	);
}
