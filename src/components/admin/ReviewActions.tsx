"use client";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { useReturnWords } from "./review-words";
import { useRef, useState } from "react";
import {
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@nextui-org/react";
import {
	CheckmarkCircle02Icon,
	Tick01Icon,
	Cancel01Icon,
	Comment01Icon,
	AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import DialogModal from "@/components/nextui/DialogModal";
import { toast } from "sonner";
import { ReviewPublicationProgress } from "./ReviewPublicationProgress";
import { useAdminSession } from "./AdminSessionProvider";
import {
	AdminApiError,
	approveAdminReview,
	updateAdminReview,
	type AdminReviewSnapshot,
} from "./admin-api";
type ReviewActionProps = {
	disabled?: boolean;
	publishBlocked?: boolean;
	snapshot: Pick<
		AdminReviewSnapshot,
		| "key"
		| "reviewId"
		| "reviewRevision"
		| "reviewState"
		| "title"
		| "submittedAt"
		| "publishing"
	>;
	onUpdated: (receipts?: readonly AdminSearchIndexReceipt[]) => Promise<void>;
};

export function ReviewActions({
	snapshot,
	onUpdated,
	disabled = false,
	publishBlocked = false,
}: ReviewActionProps) {
	const { canPublish } = useAdminSession();
	const words = useReturnWords();
	const state = useReviewAction(
		snapshot,
		onUpdated,
		disabled,
		publishBlocked,
	);
	const { setDialog, setError, setCorrectionRevision } = state;
	if (snapshot.reviewState === "published")
		return <ReviewPublicationProgress snapshot={snapshot} />;
	if (snapshot.reviewState !== "pending") return null;
	return (
		<>
			{canPublish ? (
				<div className="admin-action-row flex w-full items-center gap-2">
					<Button
						size="xs"
						color="accent"
						className="h-9 min-w-0 flex-1 rounded-xl px-3 font-semibold"
						startContent={
							<HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
						}
						isDisabled={disabled || publishBlocked}
						onPress={() => {
							setError("");
							setCorrectionRevision(null);
							setDialog("publish");
						}}
					>
						Publish version
					</Button>
					<Button
						size="xs"
						variant="muted"
						className="h-9 shrink-0 rounded-xl px-3"
						startContent={
							<HugeiconsIcon icon={Comment01Icon} size={14} />
						}
						isDisabled={disabled}
						onPress={() => {
							setError("");
							setDialog("changes");
						}}
					>
						{words.action}
					</Button>
				</div>
			) : (
				<p className="mt-3 text-[11px] text-black/45 dark:text-white/45">
					An editor will review this version before publishing.
				</p>
			)}
			<ReviewDialog
				snapshot={snapshot}
				disabled={
					disabled || (state.dialog === "publish" && publishBlocked)
				}
				state={state}
			/>
		</>
	);
}

function ReviewDialog({
	snapshot,
	disabled,
	state,
}: Pick<ReviewActionProps, "snapshot" | "disabled"> & {
	state: ReturnType<typeof useReviewAction>;
}) {
	const words = useReturnWords();
	const {
		dialog,
		feedback,
		error,
		busy,
		checks,
		confirmCorrection,
		setDialog,
		setFeedback,
		submit,
	} = state;
	return (
		<DialogModal
			isOpen={Boolean(dialog)}
			onOpenChange={(open) => {
				if (!open && !busy) setDialog(null);
			}}
			size="md"
		>
			<ModalContent>
				<ModalHeader className="flex items-center justify-between gap-3">
					{dialog === "publish"
						? "Publish submitted version"
						: words.title}
					<Button
						isIconOnly
						size="xs"
						variant="transparent"
						aria-label="Close review"
						isDisabled={busy}
						onPress={() => setDialog(null)}
					>
						<HugeiconsIcon icon={Cancel01Icon} size={16} />
					</Button>
				</ModalHeader>
				<ModalBody className="gap-4">
					{error && (
						<p role="alert" className="text-xs text-danger">
							{error}
						</p>
					)}
					<div>
						<p className="text-sm font-medium leading-relaxed">
							{snapshot.title}
						</p>
						<p className="mt-1 text-xs text-black/45 dark:text-white/45">
							Submitted{" "}
							{new Date(snapshot.submittedAt).toLocaleString()}
						</p>
					</div>
					{dialog === "changes" ? (
						<Textarea
							label={words.field}
							placeholder={words.placeholder}
							minRows={4}
							value={feedback}
							onValueChange={setFeedback}
							isInvalid={Boolean(error)}
							errorMessage={error}
						/>
					) : (
						<>
							<div className="overflow-hidden rounded-xl bg-black/[0.025] dark:bg-white/[0.035]">
								{checks.map((check) => (
									<div
										key={check.label}
										className="flex items-center gap-2.5 px-3 py-2.5 text-xs"
									>
										<HugeiconsIcon
											icon={
												check.ready
													? Tick01Icon
													: AlertCircleIcon
											}
											size={15}
											className={
												check.ready
													? "text-emerald-600 dark:text-emerald-400"
													: "text-danger"
											}
										/>
										<span>{check.label}</span>
										<span className="ml-auto text-black/40 dark:text-white/40">
											{check.ready ? "Ready" : "Missing"}
										</span>
									</div>
								))}
							</div>
							<p className="text-xs leading-relaxed text-black/55 dark:text-white/55">
								This submitted version will become public. Later
								working-draft edits stay private.
							</p>
						</>
					)}
				</ModalBody>
				<ModalFooter>
					<Button
						size="sm"
						variant="transparent"
						isDisabled={busy}
						onPress={() => setDialog(null)}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						color="accent"
						isDisabled={
							disabled ||
							busy ||
							(dialog === "publish"
								? checks.some((c) => !c.ready)
								: !feedback.trim())
						}
						onPress={() => void submit()}
						isLoading={busy}
					>
						{dialog === "publish"
							? confirmCorrection
								? "Publish correction"
								: "Publish version"
							: words.confirm}
					</Button>
				</ModalFooter>
			</ModalContent>
		</DialogModal>
	);
}

function useReviewAction(
	snapshot: ReviewActionProps["snapshot"],
	onUpdated: ReviewActionProps["onUpdated"],
	disabled: boolean,
	publishBlocked: boolean,
) {
	const words = useReturnWords();
	const [dialog, setDialog] = useState<"publish" | "changes" | null>(null);
	const [feedback, setFeedback] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [correctionRevision, setCorrectionRevision] = useState<number | null>(
		null,
	);
	const confirmCorrection = correctionRevision === snapshot.reviewRevision;
	const pending = useRef(false);
	const checks = [
		{
			label: "Submitted version",
			ready: snapshot.reviewState === "pending",
		},
	];
	const blocked = disabled || (dialog === "publish" && publishBlocked);
	const submit = async () => {
		if (pending.current || blocked) return;
		pending.current = true;
		setBusy(true);
		setError("");
		try {
			let receipts: readonly AdminSearchIndexReceipt[] = [];
			if (dialog === "publish")
				receipts = (
					await approveAdminReview(
						snapshot.reviewId,
						snapshot.reviewRevision,
						confirmCorrection ? "minor_correction" : undefined,
					)
				).indexingReceipts;
			else
				await updateAdminReview(snapshot.reviewId, {
					action: "returned",
					expectedRevision: snapshot.reviewRevision,
					note: feedback.trim(),
				});
			setDialog(null);
			setFeedback("");
			setCorrectionRevision(null);
			await finishReviewUpdate(onUpdated, receipts, dialog, words.done);
		} catch (error) {
			setCorrectionRevision(
				error instanceof AdminApiError &&
					error.code === "confirmation_required"
					? snapshot.reviewRevision
					: null,
			);
			setError(
				error instanceof Error
					? error.message
					: "Could not update review",
			);
		} finally {
			pending.current = false;
			setBusy(false);
		}
	};

	return {
		dialog,
		feedback,
		error,
		busy,
		checks,
		confirmCorrection,
		setDialog,
		setFeedback,
		setError,
		setCorrectionRevision,
		submit,
	};
}

async function finishReviewUpdate(
	onUpdated: ReviewActionProps["onUpdated"],
	receipts: readonly AdminSearchIndexReceipt[],
	dialog: "publish" | "changes" | null,
	returned: string,
) {
	try {
		await onUpdated(receipts);
		toast.success(
			dialog === "publish"
				? "Submitted version published"
				: returned,
		);
	} catch (error) {
		toast.error(
			error instanceof Error
				? error.message
				: "Could not finish the public search update",
		);
	}
}
