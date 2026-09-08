"use client";

import useSWR from "swr";
import { getAdminItemReviews, getAdminReview } from "./admin-api";

export function useItemReview(itemKey: string | undefined) {
	const reviews = useSWR(itemKey ? ["admin-reviews", itemKey] : null, ([, key]) => getAdminItemReviews(key));
	const latest = reviews.data?.[0];
	const snapshot = useSWR(latest ? ["admin-review", latest.id, latest.revision] : null, ([, id]) => getAdminReview(String(id)));
	return {
		snapshot: snapshot.data,
		pending: latest?.state === "pending",
		loading: reviews.isLoading || snapshot.isLoading,
		error: reviews.error ?? snapshot.error,
		refresh: () => reviews.mutate(),
	};
}
