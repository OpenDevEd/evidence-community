"use client";

import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import { STORAGE_KEY, StoredUtm } from "@/components/features/UtmProvider";
import { useLocalStorage } from "usehooks-ts";

export function useUtm() {
	const { consentState } = useAnalyticsConsent();
	const [stored] = useLocalStorage<StoredUtm | null>(
		STORAGE_KEY,
		null
	);

	return consentState === "granted" ? stored : null;
}
