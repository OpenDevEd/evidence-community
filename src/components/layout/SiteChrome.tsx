"use client";

import dynamic from "next/dynamic";
import { SkipLink } from "./SkipLink";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";

import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { asksAnalyticsConsent } from "@/lib/analytics-consent";
import { isAdminPath } from "@/lib/path";

const Banner = dynamic(() => import("./Banner"));
const Footer = dynamic(() => import("./Footer"));
const Navbar = dynamic(() => import("./navbar"));

/** The links that jump to the page or the footer, which admin does not have. */
function ReaderHeader({
	admin,
	skipNavigationLabel,
	skipToContentLabel,
	skipToFooterLabel,
}: {
	admin: boolean;
	skipNavigationLabel: string;
	skipToContentLabel: string;
	skipToFooterLabel: string;
}) {
	if (admin) return null;

	return (
		<>
			<nav
				aria-label={skipNavigationLabel}
				className="absolute start-0 top-0 h-0 w-64"
			>
				<SkipLink href="#page-content">{skipToContentLabel}</SkipLink>
				<SkipLink href="#footer">{skipToFooterLabel}</SkipLink>
			</nav>
			<Navbar />
		</>
	);
}

export default function SiteChrome({
	children,
	skipNavigationLabel,
	skipToContentLabel,
	skipToFooterLabel,
}: {
	children: React.ReactNode;
	skipNavigationLabel: string;
	skipToContentLabel: string;
	skipToFooterLabel: string;
}) {
	const pathname = usePathname();
	const locale = useLocale();
	const { isPreferencesOpen } = useAnalyticsConsent();
	const admin = isAdminPath(pathname, locale);
	const config = useLibraryConfig();
	const asksConsent = asksAnalyticsConsent(pathname, locale, config);

	return (
		<>
			{/*
			 * Held still, not hidden. A reader who has not answered the cookie
			 * question can see the library but cannot use it, so nothing is
			 * typed into a page that is about to be covered by the question.
			 * The server already knows the stored answer, so this holds from
			 * the first drawing rather than a moment later. `display: contents`
			 * keeps the page's own layout exactly as it was.
			 */}
			<div
				className="contents"
				data-consent-gate
				inert={asksConsent && isPreferencesOpen}
			>
				<ReaderHeader
					admin={admin}
					skipNavigationLabel={skipNavigationLabel}
					skipToContentLabel={skipToContentLabel}
					skipToFooterLabel={skipToFooterLabel}
				/>
				<div id="page-content" tabIndex={-1} className="flex w-full flex-1 flex-col items-center focus:outline-none">
					{children}
				</div>
				{admin ? null : <Footer />}
			</div>
			{asksConsent ? <Banner /> : null}
		</>
	);
}
