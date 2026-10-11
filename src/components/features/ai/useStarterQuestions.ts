"use client";

import { useLocale } from "next-intl";
import useSWR from "swr";

import { getAnalyticsDistinctId } from "@/lib/analytics";
import { analyticsIdField } from "@/lib/ai/chat-request";
import { fetcherPOST } from "@/lib/utils";
import type { AttachedItem } from "./AskAbout";

/** Questions to start with about the attached publication, while the window is open and nothing has been asked. */
export function useStarterQuestions(attached: AttachedItem | null, wanted: boolean) {
	const locale = useLocale();
	const { data } = useSWR<string[]>(
		wanted && attached
			? ["/ai/questions", { prompt: attached.key, ...analyticsIdField(getAnalyticsDistinctId()) }, { "Accept-Language": locale }]
			: null,
		fetcherPOST,
		{ revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false },
	);
	return data;
}
