"use client";

import useSWR from "swr";
import { getAdminItemReviews, getAdminReview } from "./admin-api";

export function useItemReview(itemKey: string | undefined) {
	const review = useSWR(
		itemKey ? ["admin-reviews", itemKey] : null,
		async ([, key]) => {
			const [latest] = await getAdminItemReviews(key);
			return latest ? getAdminReview(latest.id) : null;
		},
	);
	return {
		snapshot: review.data ?? undefined,
		pending: review.data?.reviewState === "pending",
		loading: review.isLoading,
		error: review.error,
		refresh: () => review.mutate(),
	};
}
