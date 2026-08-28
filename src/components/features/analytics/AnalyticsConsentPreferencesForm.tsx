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
	const { preferences, savePreferences, setConsentState } =
		useAnalyticsConsent();
	const [analytics, setAnalytics] = useState(preferences.analytics);
	const [sessionReplay, setSessionReplay] = useState(
		preferences.sessionReplay,
	);
	const preferencesKey = `${preferences.analytics}:${preferences.sessionReplay}`;
	const [previousPreferencesKey, setPreviousPreferencesKey] =
		useState(preferencesKey);
	const t = useTranslations("ui");

	if (previousPreferencesKey !== preferencesKey) {
		setPreviousPreferencesKey(preferencesKey);
		setAnalytics(preferences.analytics);
		setSessionReplay(preferences.sessionReplay);
	}

	const finish = (action: () => void) => {
		action();
		onComplete?.();
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="overflow-hidden rounded-2xl bg-default-100/65 p-1 dark:bg-default-100/25">
				<div className="flex min-h-16 items-center justify-between gap-4 rounded-xl px-3 py-2.5">
					<div className="min-w-0">
						<p className="text-sm font-semibold">
							{t("cookieAnalyticsLabel")}
						</p>
						<p className="mt-0.5 text-xs leading-4 text-default-500">
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
				<div className="mx-3 h-px bg-divider" />
				<div className="flex min-h-16 items-center justify-between gap-4 rounded-xl px-3 py-2.5">
					<div className="min-w-0">
						<p className="text-sm font-semibold">
							{t("cookieReplayLabel")}
						</p>
						<p className="mt-0.5 text-xs leading-4 text-default-500">
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
			<div className="grid grid-cols-2 gap-2">
				<Button
					color="tertiary"
					onPress={() => finish(() => setConsentState("granted"))}
					className="col-span-2 h-10 px-4 font-medium"
				>
					{t("cookieAccept")}
				</Button>
				<Button
					color="default"
					onPress={() =>
						finish(() =>
							savePreferences({
								analytics,
								sessionReplay: analytics && sessionReplay,
							}),
						)
					}
					className="h-10 px-4 font-medium"
				>
					{t("cookieSavePreferences")}
				</Button>
				<Button
					color="tertiary"
					onPress={() => finish(() => setConsentState("denied"))}
					className="h-10 px-4 font-medium"
				>
					{t("cookieDecline")}
				</Button>
			</div>
		</div>
	);
}
