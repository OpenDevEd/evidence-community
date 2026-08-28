"use client";

import { AnalyticsConsentDialogContent } from "@/components/features/analytics/AnalyticsConsentDialogContent";
import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import DialogModal from "@/components/nextui/DialogModal";

/** The cookie question. The page around it decides where it is asked. */
export default function Banner() {
	const { isPreferencesOpen } = useAnalyticsConsent();

	return (
		<DialogModal
			scrollBehavior="inside"
			isDismissable={false}
			isKeyboardDismissDisabled
			size="lg"
			isOpen={isPreferencesOpen}
			backdrop="opaque"
			classNames={{
				base: "max-h-dvh border border-divider bg-background_light dark:bg-card",
			}}
		>
			<AnalyticsConsentDialogContent />
		</DialogModal>
	);
}
