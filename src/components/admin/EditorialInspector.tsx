"use client";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { type ComponentProps, useRef, useState } from "react";
import { SquareLock01Icon, PencilIcon, InboxIcon, RotateLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { toast } from "sonner";
import { AdminInspector } from "./AdminInspector";
import { useItemReview } from "./useItemReview";
import { useAdminSession } from "./AdminSessionProvider";
import { updateAdminReview } from "./admin-api";
import { useReviewCorrections } from "./useReviewCorrections";
import { linkKeysFromPayload } from "./admin-diff";
import type { AdminItemLinkKind } from "@/lib/admin/types";
import { DraftConflict } from "./DraftConflict";
import { ReviewActions } from "./ReviewActions";

export type ReviewLinkPicker = {
 itemKey: string;
 keys: ReadonlySet<string>;
 change: (keys: readonly string[], selected: boolean) => ReadonlySet<string>;
};
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
 const reviewEdit = useRef({detail: frozenDetail, payload: reviewPayload, change: corrections.change});
 reviewEdit.current = {detail: frozenDetail, payload: reviewPayload, change: corrections.change};
 const startReviewLinkPick = (kind: AdminItemLinkKind) => {
  if (!frozenDetail || !pending || session.role === "creator") return;
  const sourceKeys = frozenDetail.links.fromSources.filter(link => link.kind === kind).map(link => link.key);
  props.onStartReviewLinkPick(kind, {
   itemKey: frozenDetail.key,
   keys: new Set([...linkKeysFromPayload(reviewPayload, frozenDetail.links.publishedKeys)[kind], ...sourceKeys]),
   change: (keys, selected) => {
    const edit = reviewEdit.current;
    if (!edit.detail) return new Set<string>();
    const links = linkKeysFromPayload(edit.payload, edit.detail.links.publishedKeys);
    const next = selected
     ? [...new Set([...links[kind], ...keys.filter(key => key !== edit.detail?.key && !sourceKeys.includes(key))])]
     : links[kind].filter(key => !keys.includes(key));
    const payload = {...edit.payload, links: {...links, [kind]: next}};
    reviewEdit.current = {...edit, payload};
    edit.change(edit.detail.key, payload);
    return new Set([...next, ...sourceKeys]);
   },
  });
 };
 const controls = snapshot ? (
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
						onClick={() => {
							props.onStopLinkPick?.();
							setSubmitted(value);
							setAttachmentKey(null);
						}}
						className={`relative flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 py-3 text-xs font-medium transition-[background-color,color] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${viewingSubmitted === value ? "bg-black/[0.045] text-black/85 dark:bg-white/[0.045] dark:text-white/85" : "text-black/45 hover:text-black/70 dark:text-white/45"}`}
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
		</div>
	) : undefined;
	const notice = snapshot ? (
		<div className="mt-4 flex items-center gap-2.5">
			<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/[0.08] text-accent-700 dark:text-accent-300">
				<HugeiconsIcon icon={InboxIcon} size={16} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium text-black/75 dark:text-white/80">
					{pending ? "Awaiting review" : snapshot.reviewState === "published" ? "Published version" : snapshot.reviewState === "returned" ? "Changes requested" : "Withdrawn"}
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
                    onPress={() => {
                        setWithdrawing(true);
                        void updateAdminReview(snapshot.reviewId, { action: "withdrawn", expectedRevision: snapshot.reviewRevision }).then(() => {
                            setSubmitted(false); setAttachmentKey(null); changed();
                        }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not withdraw review")).finally(() => setWithdrawing(false));
                    }}
				>
					Withdraw
				</Button>
			)}
		</div>
	) : undefined;
	const draftNotice = (
		<>
			{notice}
 {hasConflict && <Button size="xs" variant="transparent" className="mt-3 h-8 w-full justify-between rounded-lg bg-amber-500/[0.07] px-3 text-amber-800 dark:text-amber-300" onPress={() => { conflictRef.current?.scrollIntoView({block: "start", behavior: "smooth"}); conflictRef.current?.focus({preventScroll: true}); }}><span>{conflictFields.length} conflicts</span><span>Resolve →</span></Button>}
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
