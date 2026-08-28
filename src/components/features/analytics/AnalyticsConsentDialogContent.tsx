"use client";

import { AnalyticsConsentPreferencesForm } from "@/components/features/analytics/AnalyticsConsentPreferencesForm";
import { LibraryLogo } from "@/components/library/LibraryIdentity";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Link } from "@/i18n/routing";
import { ModalBody, ModalContent } from "@nextui-org/react";
import { useTranslations } from "next-intl";

export function AnalyticsConsentDialogContent({
	onComplete,
}: {
	onComplete?: () => void;
}) {
	const { legal } = useLibraryConfig();
	const t = useTranslations("ui");
	const tFooter = useTranslations("footer");

	return (
		/*
		 * The dialog is named after its own title. NextUI only sets
		 * `aria-labelledby` when one of its own `ModalHeader`s is used, and
		 * that header carries its own text size, so the name is given here
		 * instead and matches the heading below word for word.
		 */
		<ModalContent
			aria-label={t("cookieConsentTitle")}
			className="px-4 pb-4 pt-5 sm:px-6 sm:pb-5"
		>
			<ModalBody className="gap-0 p-0">
				<header className="flex flex-col items-center text-center">
					<LibraryLogo place="cookie" />
					<h2 className="mt-4 text-balance text-2xl font-semibold leading-tight tracking-tight text-foreground">
						{t("cookieConsentTitle")}
					</h2>
					<p className="mt-2 max-w-lg text-pretty text-sm leading-5 text-default-500">
						{t("cookieConsentMessage")}
					</p>
					<nav
						aria-label={t("cookieConsentTitle")}
						className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs"
					>
						{legal.privacyPolicy ? (
							<Link
								href={legal.privacyPolicy}
								className="text-foreground/65 underline decoration-foreground/25 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary"
							>
								{tFooter("privacyPolicy")}
							</Link>
						) : null}
						{legal.cookiePolicy ? (
							<Link
								href={legal.cookiePolicy}
								className="text-foreground/65 underline decoration-foreground/25 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary"
							>
								{tFooter("cookiePolicy")}
							</Link>
						) : null}
					</nav>
				</header>

				<div className="mt-4">
					<AnalyticsConsentPreferencesForm onComplete={onComplete} />
				</div>
			</ModalBody>
		</ModalContent>
	);
}
