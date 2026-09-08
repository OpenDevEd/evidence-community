"use client";
import { type ComponentProps, useState } from "react";
import { SquareLock01Icon, PencilIcon, InboxIcon, RotateLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { toast } from "sonner";
import { AdminInspector } from "./AdminInspector";
import { useItemReview } from "./useItemReview";
import { useAdminSession } from "./AdminSessionProvider";
import { updateAdminReview } from "./admin-api";
import { ReviewActions } from "./ReviewActions";

type Props = ComponentProps<typeof AdminInspector> & { reviewQueue: boolean };

export function EditorialInspector(props: Props) {
	return <ReviewInspector key={`${props.detail?.key ?? "empty"}:${props.reviewQueue}`} {...props} />;
}

function ReviewInspector(props: Props) {
	const key = props.detail?.key ?? "";
 const { snapshot, pending, refresh, error } = useItemReview(props.detail?.parentItem ? undefined : props.detail?.key);
 const session = useAdminSession();
 const [submitted, setSubmitted] = useState(props.reviewQueue);
 const [withdrawing, setWithdrawing] = useState(false);
 const feedback = snapshot?.reviewState === "returned" ? snapshot.note : null;
 const canWithdraw = snapshot && (session.role !== "creator" || snapshot.submittedBy === session.userId);
 const changed = () => { void refresh(); props.onPublicationChanged(); };
	const [attachmentKey, setAttachmentKey] = useState<string | null>(null);
	const viewingSubmitted = submitted && Boolean(snapshot);
	const frozenDetail =
		snapshot?.frozenAttachments.find((a) => a.key === attachmentKey) ??
		snapshot;
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
				reviewPending={pending}
			/>
		);
	return (
		<AdminInspector
			{...props}
			detail={frozenDetail}
			payload={
				frozenDetail.draft?.payload ?? frozenDetail.published ?? {}
			}
			readOnlyVersion
            publishingChoice={snapshot.publishing}
            onChange={() => undefined}
			versionActions={
				<ReviewActions
					snapshot={snapshot}
					onUpdated={changed}
				/>
			}
			versionControls={controls}
			versionNotice={notice}
			linkTargets={frozenDetail.links.targets}
			linkPickKind={null}
			fileErrors={{}}
			validationErrors={{}}
			validationRevision={0}
			loading={false}
			error={null}
			saveMessage={null}
			saveState="idle"
			onSelectAttachment={setAttachmentKey}
			onBackToParent={(target) => {
				if (target === key) setAttachmentKey(null);
				else {
					setSubmitted(false);
					props.onBackToParent(target);
				}
			}}
		/>
	);
}
