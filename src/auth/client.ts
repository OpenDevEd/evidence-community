"use client";

import { useUser } from "@clerk/nextjs";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import type { AppSession, SessionStatus } from "@/auth/types";

export function useSession() {
	const { isLoaded, isSignedIn } = useUser();
	const shouldFetchSession = isLoaded && isSignedIn;

	const { data, isLoading, error, mutate } = useSWR<AppSession | null>(
		shouldFetchSession ? "/auth/session" : null,
		fetcher,
		{
			revalidateOnFocus: false,
			errorRetryCount: 2,
		}
	);

	let status: SessionStatus = "unauthenticated";
	if (!isLoaded || (shouldFetchSession && isLoading && data === undefined)) {
		status = "loading";
	} else if (shouldFetchSession && data) {
		status = "authenticated";
	} else if (shouldFetchSession && error) {
		status = "unauthenticated";
		console.error("Session fetch failed:", error);
	}

	const update = async () => {
		if (!shouldFetchSession) {
			return null;
		}
		const next = await mutate();
		return next ?? null;
	};

	return {
		data: shouldFetchSession ? (data ?? null) : null,
		status,
		update,
	};
}
