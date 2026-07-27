"use client";

import { Button } from "../nextui/Button";
import DialogModal from "../nextui/DialogModal";
import GenericHeader from "../features/modals/GenericHeader";
import { ModalBody, ModalContent, ModalFooter } from "@nextui-org/react";
import { useTranslations } from "next-intl";
import { Logo } from "./navbar";
import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import { Link } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/routing";
import { isPolicyPage } from "@/lib/legal-links";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

export default function Banner() {
	const { isPreferencesOpen, setConsentState } = useAnalyticsConsent();
	const { legal } = useLibraryConfig();
	const pathname = usePathname();
	const router = useRouter();
	const t = useTranslations("ui");
	const tFooter = useTranslations("footer");
	const onPolicyPage = isPolicyPage(pathname);

	// On policy pages: don't show the banner at all.
	// The footer Preferences button handles policy pages separately.
	if (onPolicyPage) return null;

	return (
		<DialogModal
			scrollBehavior="inside"
			isDismissable={false}
			isKeyboardDismissDisabled
			size="xl"
			isOpen={isPreferencesOpen}
			backdrop="blur"
			classNames={{
				base: "backdrop-blur-xl bg-background_light/60 dark:bg-card/60 border border-divider",
			}}
		>
			<ModalContent className="p-6 pb-4">
				<div className="flex justify-center p-4">
					<Logo />
				</div>
				<GenericHeader
					classNames={{
						base: "justify-center",
					}}
				>
					{t("cookieConsentTitle")}
				</GenericHeader>
				<ModalBody>
					<p className="text-center text-default-500 mx-auto max-w-md mb-6">
						{t("cookieConsentMessage")}
					</p>
					<div className="mb-4">
						<h4 className="text-center font-medium mb-5 text-sm uppercase tracking-wide text-default-600">
							{t("cookieDataUsageTitle")}
						</h4>
						<div className="flex flex-wrap justify-center gap-3 max-w-lg mx-auto">
							<div className="flex items-center bg-gradient-to-r from-blue-100 to-blue-50 dark:from-blue-900/30 dark:to-blue-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									{t("dataUsageImprove")}
								</span>
							</div>
							<div className="flex items-center bg-gradient-to-r from-purple-100 to-purple-50 dark:from-purple-900/30 dark:to-purple-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									{t("dataUsagePreferences")}
								</span>
							</div>
							<div className="flex items-center bg-gradient-to-r from-emerald-100 to-emerald-50 dark:from-emerald-900/30 dark:to-emerald-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									{t("dataUsageFeatures")}
								</span>
							</div>
							<div className="flex items-center bg-gradient-to-r from-amber-100 to-amber-50 dark:from-amber-900/30 dark:to-amber-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									{t("dataUsagePersonalize")}
								</span>
							</div>
							<div className="flex items-center bg-gradient-to-r from-rose-100 to-rose-50 dark:from-rose-900/30 dark:to-rose-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									{t("dataUsageBugs")}
								</span>
							</div>
						</div>
					</div>
					<div className="flex flex-wrap items-center justify-center gap-4 text-sm">
						{legal.privacyPolicy ? (
							<Link
								href={legal.privacyPolicy}
								className="text-black/70 dark:text-white/70 underline underline-offset-4"
							>
								{tFooter("privacyPolicy")}
							</Link>
						) : null}
						{legal.cookiePolicy ? (
							<Link
								href={legal.cookiePolicy}
								className="text-black/70 dark:text-white/70 underline underline-offset-4"
							>
								{tFooter("cookiePolicy")}
							</Link>
						) : null}
					</div>
				</ModalBody>
				<ModalFooter className="flex-row flex-wrap items-center justify-center gap-3 pt-2">
					<Button
						color="tertiary"
						onPress={() => setConsentState("granted")}
						className="px-6 font-medium"
					>
						{t("cookieAccept")}
					</Button>
					<Button
						color="tertiary"
						onPress={() => setConsentState("denied")}
						className="px-6 font-medium"
					>
						{t("cookieDecline")}
					</Button>
				</ModalFooter>
			</ModalContent>
		</DialogModal>
	);
}
