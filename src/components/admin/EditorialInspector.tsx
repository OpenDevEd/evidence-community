"use client";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { type ComponentProps, useRef, useState } from "react";
import { toast } from "sonner";
import { AdminInspector } from "./AdminInspector";
import { useItemReview } from "./useItemReview";
import { useAdminSession } from "./AdminSessionProvider";
import { updateAdminReview } from "./admin-api";
import { useReviewCorrections } from "./useReviewCorrections";
import { useReviewLinkPicker, type ReviewLinkPicker } from "./useReviewLinkPicker";
import type { AdminItemLinkKind } from "@/lib/admin/types";
import { DraftConflict } from "./DraftConflict";
import { ReviewActions } from "./ReviewActions";
import { ReviewVersionTabs, ReviewVersionNotice, ReviewDraftNotice } from "./ReviewVersionControls";

type Props = ComponentProps<typeof AdminInspector> & {
 reviewQueue: boolean;
 onStartReviewLinkPick: (kind: AdminItemLinkKind, picker: ReviewLinkPicker) => void;
};

export function EditorialInspector(props: Props) {
	return <ReviewInspector key={`${props.detail?.key ?? "empty"}:${props.reviewQueue}`} {...props} />;
}

function ReviewInspector(props: Props) {
	const key = props.detail?.key ?? "";
 const { snapshot, pending, refresh, error } = useItemReview(props.detail?.parentItem ?? props.detail?.key);
 const session = useAdminSession();
 const corrections = useReviewCorrections(snapshot, refresh);
 const [submitted, setSubmitted] = useState(props.reviewQueue);
 const [withdrawing, setWithdrawing] = useState(false);
 const feedback = snapshot?.reviewState === "returned" ? snapshot.note : null;
 const canWithdraw = snapshot && (session.role !== "creator" || snapshot.submittedBy === session.userId);
 const changed = (receipts?: readonly AdminSearchIndexReceipt[]) => { props.onStopLinkPick?.(); void refresh(); props.onPublicationChanged(receipts); };
 const conflictRef = useRef<HTMLDivElement>(null);
 const [resolving, setResolving] = useState(false);
 const conflictFields = snapshot?.remainingConflicts[key] ?? [];
 const hasConflict = conflictFields.length > 0;
 const resolveConflicts = async (choices: Record<string, "draft" | "published">) => {
  const draft = props.detail?.draft;
  if (!snapshot || !draft) return;
  setResolving(true);
  try {
   await updateAdminReview(snapshot.reviewId, {action: "resolve-conflicts", expectedRevision: snapshot.reviewRevision, itemKey: key, generation: draft.generation, draftRevision: draft.draftRevision, choices});
   changed();
   toast.success("Draft conflicts resolved");
  } catch (error) { toast.error(error instanceof Error ? error.message : "Could not resolve conflicts"); }
  finally { setResolving(false); }
 };
	const [attachmentKey, setAttachmentKey] = useState<string | null>(null);
	const viewingSubmitted = submitted && Boolean(snapshot);
	const frozenDetail =
		snapshot?.frozenAttachments.find((a) => a.key === attachmentKey) ??
		snapshot;
	const reviewPayload = corrections.payloads[frozenDetail?.key ?? ""] ?? frozenDetail?.draft?.payload ?? frozenDetail?.published ?? {};
 const startReviewLinkPick = useReviewLinkPicker({
  detail: frozenDetail, payload: reviewPayload, change: corrections.change,
  enabled: Boolean(pending) && session.role !== "creator", onStart: props.onStartReviewLinkPick,
 });
 const controls = snapshot ? <ReviewVersionTabs viewingSubmitted={viewingSubmitted} onSelect={value => {
  props.onStopLinkPick?.(); setSubmitted(value); setAttachmentKey(null);
 }} /> : undefined;
 const withdraw = () => {
  if (!snapshot) return;
  setWithdrawing(true);
  void updateAdminReview(snapshot.reviewId, {action: "withdrawn", expectedRevision: snapshot.reviewRevision}).then(() => {
   setSubmitted(false); setAttachmentKey(null); changed();
  }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not withdraw review")).finally(() => setWithdrawing(false));
 };
 const notice = snapshot ? <ReviewVersionNotice snapshot={snapshot} pending={pending} canWithdraw={Boolean(canWithdraw)} withdrawing={withdrawing} onWithdraw={withdraw} /> : undefined;
 const draftNotice = <ReviewDraftNotice notice={notice} conflictCount={conflictFields.length} feedback={feedback} onConflicts={() => {
  conflictRef.current?.scrollIntoView({block: "start", behavior: "smooth"}); conflictRef.current?.focus({preventScroll: true});
 }} />;

	if (!viewingSubmitted || !frozenDetail || !snapshot)
		return (
			<AdminInspector
				{...props}
				error={error instanceof Error ? error.message : props.error}
                versionControls={controls}
				versionNotice={draftNotice}
                editorNotice={hasConflict ? <div ref={conflictRef} tabIndex={-1} className="mb-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-focus"><DraftConflict key={`${snapshot?.reviewRevision}:${props.detail?.draft?.draftRevision}`} payload={props.payload} published={props.detail?.published ?? {}} conflictFields={conflictFields} disabled={resolving || props.saveState === "saving"} onResolve={choices => { void resolveConflicts(choices); }} /></div> : undefined}
                submissionBlocked={hasConflict}
				reviewPending={pending}
			/>
		);
	return (
		<AdminInspector
			{...props}
			detail={frozenDetail}
			payload={
				corrections.payloads[frozenDetail.key] ?? frozenDetail.draft?.payload ?? frozenDetail.published ?? {}
			}
			readOnlyVersion
            allowReviewCorrections={pending && session.role !== "creator"}
            publishingChoice={snapshot.publishing}
            onChange={payload => corrections.change(frozenDetail.key, payload)}
			versionActions={
				<ReviewActions
					snapshot={snapshot}
                    disabled={corrections.saving || Boolean(corrections.error)}
					onUpdated={changed}
				/>
			}
			versionControls={controls}
			versionNotice={notice}
			linkTargets={[...(props.linkTargets ?? []), ...frozenDetail.links.targets]}
            onStartLinkPick={startReviewLinkPick}
			fileErrors={{}}
			validationErrors={{}}
			validationRevision={0}
			loading={false}
			error={corrections.error}
			saveMessage={corrections.error}
			saveState={corrections.error ? "error" : corrections.saving ? "saving" : "saved"}
			onSelectAttachment={(key) => { props.onStopLinkPick?.(); setAttachmentKey(key); }}
			onBackToParent={(target) => {
                props.onStopLinkPick?.();
				if (target === key) setAttachmentKey(null);
				else {
					setSubmitted(false);
					props.onBackToParent(target);
				}
			}}
		/>
	);
}
