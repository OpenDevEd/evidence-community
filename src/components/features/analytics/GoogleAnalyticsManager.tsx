"use client";

import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import {
	markGoogleAnalyticsReady,
	prepareGoogleAnalytics,
	resetGoogleAnalytics,
	updateGoogleConsent,
} from "@/lib/analytics";
import Script from "next/script";
import { useEffect } from "react";

export default function GoogleAnalyticsManager({
	gaId,
}: {
	gaId: string;
}) {
	const { consentState } = useAnalyticsConsent();
	const isGranted = consentState === "granted";

	useEffect(() => {
		if (!gaId || typeof window === "undefined") {
			return;
		}

		if (!isGranted) {
			resetGoogleAnalytics();
			updateGoogleConsent(false);
			return;
		}

		prepareGoogleAnalytics(gaId);
		updateGoogleConsent(true);
	}, [gaId, isGranted]);

	if (!gaId || !isGranted) {
		return null;
	}

	return (
		<Script
			id="ga-loader"
			src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
			strategy="afterInteractive"
			onReady={() => {
				if (typeof window === "undefined") {
					return;
				}

				window.dataLayer = window.dataLayer || [];
				window.gtag =
					window.gtag ||
					function gtag(...args: unknown[]) {
						window.dataLayer?.push(args);
					};

				window.gtag("js", new Date());
				window.gtag("consent", "update", {
					analytics_storage: "granted",
					ad_storage: "denied",
					ad_user_data: "denied",
					ad_personalization: "denied",
				});
				window.gtag("config", gaId, {
					send_page_view: false,
					anonymize_ip: true,
					allow_google_signals: false,
					allow_ad_personalization_signals: false,
				});
				markGoogleAnalyticsReady(gaId);
			}}
		/>
	);
}
