"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";

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
	const admin = isAdminPath(pathname, locale);

	return (
		<>
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
			{admin ? null : (
				<>
					<Footer />
					<Banner />
				</>
			)}
		</>
	);
}
