"use client";
import { useState } from "react";
import { toast } from "sonner";
import { updateAdminReview, type AdminReviewSnapshot } from "./admin-api";

type Options = {
	initialSubmitted: boolean;
	itemKey: string;
	onStopLinkPick?: () => void;
	onChanged: () => unknown;
	onBackToParent: (key: string) => void;
};

export function useReviewVersion(
	snapshot: AdminReviewSnapshot | undefined,
	options: Options,
) {
	const [submitted, setSubmitted] = useState(options.initialSubmitted);
	const [attachmentKey, setAttachmentKey] = useState<string | null>(null);
	const [withdrawing, setWithdrawing] = useState(false);
	const selectVersion = (value: boolean) => {
		options.onStopLinkPick?.();
		setSubmitted(value);
		setAttachmentKey(null);
	};
	const withdraw = () => {
		if (!snapshot) return;
		setWithdrawing(true);
		void updateAdminReview(snapshot.reviewId, {
			action: "withdrawn",
			expectedRevision: snapshot.reviewRevision,
		})
			.then(() => {
				setSubmitted(false);
				setAttachmentKey(null);
				options.onChanged();
			})
			.catch((error: unknown) =>
				toast.error(
					error instanceof Error
						? error.message
						: "Could not withdraw review",
				),
			)
			.finally(() => setWithdrawing(false));
	};
	const selectAttachment = (key: string) => {
		options.onStopLinkPick?.();
		setAttachmentKey(key);
	};
	const backToParent = (target: string) => {
		options.onStopLinkPick?.();
		if (target === options.itemKey) setAttachmentKey(null);
		else {
			setSubmitted(false);
			options.onBackToParent(target);
		}
	};
	return {
		viewingSubmitted: submitted && Boolean(snapshot),
		frozenDetail:
			snapshot?.frozenAttachments.find(
				(attachment) => attachment.key === (attachmentKey ?? options.itemKey),
			) ?? snapshot,
		withdrawing,
		withdraw,
		selectVersion,
		selectAttachment,
		backToParent,
	};
}
