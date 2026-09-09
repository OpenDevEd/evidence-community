"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AdminItemDetail } from "@/lib/admin/types";
import {
	adminErrorMessage,
	updateAdminReview,
	type AdminReviewSnapshot,
} from "./admin-api";

export function useReviewDraftConflicts(
	snapshot: AdminReviewSnapshot | undefined,
	detail: AdminItemDetail,
	onChanged: () => unknown,
) {
	const ref = useRef<HTMLDivElement>(null);
	const [resolving, setResolving] = useState(false);
	const fields = snapshot?.remainingConflicts[detail.key] ?? [];
	const resolve = async (choices: Record<string, "draft" | "published">) => {
		const draft = detail.draft;
		if (!snapshot || !draft) return;
		setResolving(true);
		try {
			await updateAdminReview(snapshot.reviewId, {
				action: "resolve-conflicts",
				expectedRevision: snapshot.reviewRevision,
				itemKey: detail.key,
				generation: draft.generation,
				draftRevision: draft.draftRevision,
				choices,
			});
			onChanged();
			toast.success("Draft conflicts resolved");
		} catch (error) {
			toast.error(
				adminErrorMessage(error, "Could not resolve conflicts"),
			);
		} finally {
			setResolving(false);
		}
	};
	const focus = () => {
		ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
		ref.current?.focus({ preventScroll: true });
	};
	return { ref, resolving, fields, resolve, focus };
}
