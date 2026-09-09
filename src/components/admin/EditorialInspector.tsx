"use client";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import type { ComponentProps } from "react";
import { AdminInspector } from "./AdminInspector";
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
import {
	ReviewVersionTabs,
	ReviewVersionNotice,
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
	const key = props.detail.key;
	const { snapshot, pending, refresh, error } = useItemReview(
		props.detail.parentItem ?? props.detail.key,
	);
	const session = useAdminSession();
	const corrections = useReviewCorrections(snapshot, refresh);
	const feedback =
		snapshot?.reviewState === "returned" ? snapshot.note : null;
	const canWithdraw =
		snapshot &&
		(session.role !== "creator" || snapshot.submittedBy === session.userId);
	const changed = (receipts?: readonly AdminSearchIndexReceipt[]) => {
		props.onStopLinkPick?.();
		void refresh();
		return props.onPublicationChanged(receipts);
	};
	const {ref: conflictRef, ...conflicts} = useReviewDraftConflicts(snapshot, props.detail, changed);
	const hasConflict = conflicts.fields.length > 0;
	const version = useReviewVersion(snapshot, {
		initialSubmitted: props.reviewQueue,
		itemKey: key,
		onChanged: changed,
		onStopLinkPick: props.onStopLinkPick,
		onBackToParent: props.onBackToParent,
	});
	const { viewingSubmitted, frozenDetail } = version;
	const reviewPayload =
		corrections.payloads[frozenDetail?.key ?? ""] ??
		frozenDetail?.draft?.payload ??
		frozenDetail?.published ??
		{};
	const startReviewLinkPick = useReviewLinkPicker({
		detail: frozenDetail,
		payload: reviewPayload,
		change: corrections.change,
		enabled: Boolean(pending) && session.role !== "creator",
		onStart: props.onStartReviewLinkPick,
	});
	const controls = snapshot ? (
		<ReviewVersionTabs
			viewingSubmitted={viewingSubmitted}
			onSelect={version.selectVersion}
		/>
	) : undefined;
	const notice = snapshot ? (
		<ReviewVersionNotice
			snapshot={snapshot}
			pending={pending}
			canWithdraw={Boolean(canWithdraw)}
			withdrawing={version.withdrawing}
			onWithdraw={version.withdraw}
		/>
	) : undefined;
	const draftNotice = (
		<ReviewDraftNotice
			notice={notice}
			conflictCount={conflicts.fields.length}
			feedback={feedback}
			onConflicts={conflicts.focus}
		/>
	);

	if (!viewingSubmitted || !frozenDetail || !snapshot)
		return (
			<AdminInspector
				{...props}
				error={error instanceof Error ? error.message : props.error}
				versionControls={controls}
				versionNotice={draftNotice}
				editorNotice={
					hasConflict ? (
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
									conflicts.resolving ||
									props.saveState === "saving"
								}
								onResolve={(choices) => {
									void conflicts.resolve(choices);
								}}
							/>
						</div>
					) : undefined
				}
				submissionBlocked={hasConflict}
				reviewPending={pending}
			/>
		);
	return (
		<AdminInspector
			{...props}
			detail={frozenDetail}
			payload={reviewPayload}
			readOnlyVersion
			allowReviewCorrections={pending && session.role !== "creator"}
			publishingChoice={snapshot.publishing}
			onChange={(payload) =>
				corrections.change(frozenDetail.key, payload)
			}
			versionActions={
				<ReviewActions
					snapshot={snapshot}
					disabled={corrections.saving || Boolean(corrections.error)}
					onUpdated={changed}
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
			saveState={
				corrections.error
					? "error"
					: corrections.saving
						? "saving"
						: "saved"
			}
			onSelectAttachment={version.selectAttachment}
			onBackToParent={version.backToParent}
		/>
	);
}
