"use client";

import DialogModal from "../nextui/DialogModal";
import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import { usePathname } from "@/i18n/routing";
import { isPolicyPage } from "@/lib/legal-links";
import { AnalyticsConsentDialogContent } from "@/components/features/analytics/AnalyticsConsentDialogContent";

export default function Banner() {
	const { isPreferencesOpen } = useAnalyticsConsent();
	const pathname = usePathname();
	const onPolicyPage = isPolicyPage(pathname);

	// On policy pages: don't show the banner at all.
	// The footer Preferences button handles policy pages separately.
	if (onPolicyPage) return null;

	return (
		<DialogModal
			scrollBehavior="inside"
			isDismissable={false}
			isKeyboardDismissDisabled
			size="lg"
			isOpen={isPreferencesOpen}
			backdrop="opaque"
			classNames={{
				base: "max-h-[calc(100dvh-2rem)] bg-background_light dark:bg-card border border-divider",
			}}
		>
			<AnalyticsConsentDialogContent />
		</DialogModal>
	);
}
