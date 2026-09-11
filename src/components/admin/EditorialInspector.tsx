"use client";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import type { ComponentProps, ReactNode } from "react";
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
	reviewQueue: boolean;
	onStartReviewLinkPick: (
		kind: AdminItemLinkKind,
		picker: ReviewLinkPicker,
	) => void;
};

export function EditorialInspector(props: Props) {
	if (!props.detail) return <AdminInspector {...props} />;
	return (
		<ReviewInspector
			key={`${props.detail.key}:${props.reviewQueue}`}
			{...props}
			detail={props.detail}
		/>
	);
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
	const notice = (actions: ReactNode) => (
		<ReviewVersionNotice
			actions={actions}
			snapshot={snapshot}
			updatedAt={props.detail.draft?.updatedAt ?? props.detail.updatedAt}
			viewingSubmitted={viewingSubmitted}
			onViewSubmitted={() => version.selectVersion(true)}
		/>
	);
	const header = {
		versionStatus: (
			<ReviewStatusLabel
				snapshot={snapshot}
				detail={props.detail}
				viewingSubmitted={viewingSubmitted}
			/>
		),
		versionWithdraw: (
			<ReviewWithdrawButton
				pending={pending}
				submittedBy={snapshot?.submittedBy}
				withdrawing={version.withdrawing}
				onWithdraw={version.withdraw}
			/>
		),
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
	notice: (actions: ReactNode) => ReactNode;
};

function WorkingDraftInspector({
	model,
	controls,
	notice,
	...props
}: VersionInspectorProps) {
	const { snapshot, pending, error, conflicts } = model;
	const hasConflict = conflicts.fields.length > 0;
	const readiness = useReviewReadiness(
		props.detail,
		props.payload,
		model.publishing,
	);
	const draftNotice = (actions: ReactNode) => (
		<ReviewDraftNotice
			notice={notice(actions)}
			conflictCount={conflicts.fields.length}
			feedback={
				snapshot?.reviewState === "returned" ? snapshot.note : null
			}
			onConflicts={conflicts.focus}
		/>
	);

	return (
		<AdminInspector
			{...props}
			publishing={model.publishing}
			error={error instanceof Error ? error.message : props.error}
			versionControls={controls}
			versionNotice={draftNotice}
			editorNotice={
				<WorkingDraftNotices
					model={model}
					props={props}
					readiness={readiness}
				/>
			}
			submissionBlocked={
				hasConflict ||
				readiness.loading ||
				readiness.saving ||
				readiness.missing > 0
			}
			reviewPending={pending}
		/>
	);
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

	const readiness = useReviewReadiness(
		frozenDetail,
		reviewPayload,
		model.publishing,
		snapshot.publishing,
	);
	const saveState = corrections.saving ? "saving" : "saved";
	const reviewActions = (
		<ReviewActions
			snapshot={snapshot}
			disabled={corrections.saving || Boolean(corrections.error)}
			publishBlocked={!frozenDetail.parentItem && readiness.missing > 0}
			onUpdated={changed}
		/>
	);
	return (
		<AdminInspector
			{...props}
			publishing={model.publishing}
			detail={frozenDetail}
			payload={reviewPayload}
			readOnlyVersion
			allowReviewCorrections={pending && session.role !== "creator"}
			publishingChoice={snapshot.publishing}
			onChange={(payload) =>
				corrections.change(frozenDetail.key, payload)
			}
			versionActions={
				pending && session.role !== "creator"
					? reviewActions
					: undefined
			}
			editorNotice={
				<SubmittedNotice
					pending={pending}
					frozenDetail={frozenDetail}
					readiness={readiness}
					reviewActions={reviewActions}
				/>
			}
			versionControls={controls}
			versionNotice={notice}
			linkTargets={[
				...(props.linkTargets ?? []),
				...frozenDetail.links.targets,
			]}
			onStartLinkPick={startReviewLinkPick}
			fileErrors={{}}
			validationErrors={{}}
			validationRevision={0}
			loading={false}
			error={corrections.error}
			saveMessage={corrections.error}
			saveState={corrections.error ? "error" : saveState}
			onSelectAttachment={version.selectAttachment}
			onBackToParent={version.backToParent}
		/>
	);
}

function useReviewInspector(props: Props & { detail: AdminItemDetail }) {
	const publishing = usePublishingChoice(props.detail, false);
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
		enabled: Boolean(pending) && session.role !== "creator",
		onStart: props.onStartReviewLinkPick,
	});
	return {
		publishing,
		snapshot,
		pending,
		error,
		session,
		corrections,
		changed,
		conflictRef,
		conflicts,
		version,
		viewingSubmitted,
		frozenDetail,
		reviewPayload,
		startReviewLinkPick,
	};
}

function WorkingDraftNotices({
	model,
	props,
	readiness,
}: {
	model: VersionInspectorProps["model"];
	props: Omit<VersionInspectorProps, "model" | "controls" | "notice">;
	readiness: ReturnType<typeof useReviewReadiness>;
}) {
	const { snapshot, conflicts, conflictRef } = model;
	const hasConflict = conflicts.fields.length > 0;
	return (
		<>
			{!props.detail.parentItem && props.detail.draft && (
				<ReviewReadiness
					recordKey={props.detail.key}
					readiness={readiness}
				/>
			)}
			{hasConflict ? (
				<div
					ref={conflictRef}
					tabIndex={-1}
					className="mb-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-focus"
				>
					<DraftConflict
						key={`${snapshot?.reviewRevision}:${props.detail.draft?.draftRevision}`}
						payload={props.payload}
						published={props.detail.published ?? {}}
						conflictFields={conflicts.fields}
						disabled={
							conflicts.resolving || props.saveState === "saving"
						}
						onResolve={(choices) => {
							void conflicts.resolve(choices);
						}}
					/>
				</div>
			) : undefined}
		</>
	);
}

function SubmittedNotice({
	pending,
	frozenDetail,
	readiness,
	reviewActions,
}: {
	pending: boolean;
	frozenDetail: AdminItemDetail;
	readiness: ReturnType<typeof useReviewReadiness>;
	reviewActions: ReactNode;
}) {
	return (
		<>
			{pending && !frozenDetail.parentItem ? (
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
