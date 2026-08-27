"use client";

import { AnalyticsConsentDialogContent } from "@/components/features/analytics/AnalyticsConsentDialogContent";
import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import DialogModal from "@/components/nextui/DialogModal";
import { usePathname } from "@/i18n/routing";
import { isPolicyPage } from "@/lib/legal-links";

export default function Banner() {
	const { isPreferencesOpen } = useAnalyticsConsent();
	const pathname = usePathname();

	if (isPolicyPage(pathname)) return null;

	return (
		<DialogModal
			scrollBehavior="inside"
			isDismissable={false}
			isKeyboardDismissDisabled
			size="lg"
			isOpen={isPreferencesOpen}
			backdrop="opaque"
			classNames={{
				base: "max-h-[calc(100dvh-2rem)] border border-divider bg-background_light dark:bg-card",
			}}
		>
			<AnalyticsConsentDialogContent />
		</DialogModal>
	);
}
