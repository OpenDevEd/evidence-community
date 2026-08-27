"use client";

import { ModalBody, ModalContent } from "@nextui-org/react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/routing";
import { resolveCompanyFooterPolicyLinks } from "@/lib/legal-links";
import { useStatus } from "@/context/Providers";
import { Logo } from "@/components/layout/navbar";

import { AnalyticsConsentPreferencesForm } from "./AnalyticsConsentPreferencesForm";

export function AnalyticsConsentDialogContent({
	onComplete,
}: {
	onComplete?: () => void;
}) {
	const status = useStatus();
	const t = useTranslations("ui");
	const tFooter = useTranslations("footer");
	const policyLinks = resolveCompanyFooterPolicyLinks(
		status.companyFooter || {},
	);

	return (
		<ModalContent className="px-4 pb-4 pt-5 sm:px-6 sm:pb-5">
			<ModalBody className="gap-0 p-0">
				<header className="flex flex-col items-center text-center">
					<Logo interactive={false} dbStyle="splash" />
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
						{policyLinks.privacyPolicy ? (
							<Link
								href={policyLinks.privacyPolicy}
								className="text-foreground/65 underline decoration-foreground/25 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary"
							>
								{tFooter("privacyPolicy")}
							</Link>
						) : null}
						{policyLinks.cookiePolicy ? (
							<Link
								href={policyLinks.cookiePolicy}
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
