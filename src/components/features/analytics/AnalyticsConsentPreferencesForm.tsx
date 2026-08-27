"use client";

import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import { Button } from "@/components/nextui/Button";
import { Switch } from "@/components/nextui/Switch";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function AnalyticsConsentPreferencesForm({
	onComplete,
}: {
	onComplete?: () => void;
}) {
	const {
		consentPreferences,
		setConsentPreferences,
		setConsentState,
	} = useAnalyticsConsent();
	const [analytics, setAnalytics] = useState(consentPreferences.analytics);
	const [sessionReplay, setSessionReplay] = useState(
		consentPreferences.sessionReplay,
	);
	const preferencesKey = `${consentPreferences.analytics}:${consentPreferences.sessionReplay}`;
	const [previousPreferencesKey, setPreviousPreferencesKey] =
		useState(preferencesKey);
	const t = useTranslations("ui");

	// The banner and footer can each keep a form mounted. Reconcile a draft when
	// the other form saves, using React's render-time state adjustment pattern
	// rather than an effect that causes an avoidable extra render.
	if (previousPreferencesKey !== preferencesKey) {
		setPreviousPreferencesKey(preferencesKey);
		setAnalytics(consentPreferences.analytics);
		setSessionReplay(consentPreferences.sessionReplay);
	}

	const finish = (action: () => void) => {
		action();
		onComplete?.();
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="grid gap-3">
				<div className="flex items-start justify-between gap-5 rounded-xl border border-divider bg-default-50/60 p-4 dark:bg-default-100/20">
					<div className="min-w-0">
						<p className="font-medium">{t("cookieAnalyticsLabel")}</p>
						<p className="mt-1 text-sm text-default-500">
							{t("cookieAnalyticsDescription")}
						</p>
					</div>
					<Switch
						aria-label={t("cookieAnalyticsLabel")}
						isSelected={analytics}
						onValueChange={(selected) => {
							setAnalytics(selected);
							if (!selected) setSessionReplay(false);
						}}
					/>
				</div>
				<div className="flex items-start justify-between gap-5 rounded-xl border border-divider bg-default-50/60 p-4 dark:bg-default-100/20">
					<div className="min-w-0">
						<p className="font-medium">{t("cookieReplayLabel")}</p>
						<p className="mt-1 text-sm text-default-500">
							{t("cookieReplayDescription")}
						</p>
					</div>
					<Switch
						aria-label={t("cookieReplayLabel")}
						isDisabled={!analytics}
						isSelected={analytics && sessionReplay}
						onValueChange={setSessionReplay}
					/>
				</div>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-3 pt-1">
				<Button
					color="tertiary"
					onPress={() =>
						finish(() => setConsentState("granted"))
					}
					className="px-6 font-medium"
				>
					{t("cookieAccept")}
				</Button>
				<Button
					color="default"
					onPress={() =>
						finish(() =>
							setConsentPreferences({
								analytics,
								sessionReplay: analytics && sessionReplay,
							}),
						)
					}
					className="px-6 font-medium"
				>
					{t("cookieSavePreferences")}
				</Button>
				<Button
					color="tertiary"
					onPress={() => finish(() => setConsentState("denied"))}
					className="px-6 font-medium"
				>
					{t("cookieDecline")}
				</Button>
			</div>
		</div>
	);
}
