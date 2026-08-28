"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";

import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import { asksAnalyticsConsent } from "@/lib/analytics-consent";
import { isAdminPath } from "@/lib/path";

const Banner = dynamic(() => import("./Banner"));
const Footer = dynamic(() => import("./Footer"));
const Navbar = dynamic(() => import("./navbar"));

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
	const asksConsent = asksAnalyticsConsent(pathname, locale);
	// Held still, not hidden. A reader who has not answered the cookie
	// question can see the library but cannot use it, so nothing is typed
	// into a page that is about to be covered by the question. The server
	// already knows the stored answer, so this holds from the first drawing
	// rather than a moment later.
	const held = asksConsent && isPreferencesOpen;

	return (
		<>
			{/* `display: contents` keeps the page's own layout exactly as it was. */}
			<div className="contents" data-consent-gate inert={held}>
				{admin ? null : (
					<>
						<nav
							aria-label={skipNavigationLabel}
							className="absolute left-0 top-0 h-0 w-64"
						>
							<a
								href="#main-content"
								className="absolute left-[-999px] top-0 z-[-999] h-1 w-1 p-4 text-center opacity-0 focus:left-0 focus:z-[999] focus:h-fit focus:w-fit focus:opacity-100"
							>
								{skipToContentLabel}
							</a>
							<a
								href="#footer"
								className="absolute left-[-999px] top-0 z-[-999] h-1 w-1 p-4 text-center opacity-0 focus:left-0 focus:z-[999] focus:h-fit focus:w-fit focus:opacity-100"
							>
								{skipToFooterLabel}
							</a>
						</nav>
						<Navbar />
					</>
				)}
				<div className="flex w-full flex-1 flex-col items-center">
					{children}
				</div>
				{admin ? null : <Footer />}
			</div>
			{asksConsent ? <Banner /> : null}
		</>
	);
}
