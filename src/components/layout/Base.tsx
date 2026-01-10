import Providers from "@/context/Providers";
import { Montserrat, Ubuntu } from "next/font/google";
import Navbar from "@/components/layout/navbar";
import Footer from "@/components/layout/Footer";
import { Analytics } from "@vercel/analytics/react";
import { twMerge } from "tailwind-merge";
import { style } from "@/../tailwind.config";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getLangDir } from "rtl-detect";
import { auth } from "@/app/api/auth/[...nextauth]/config";
import { getCachedStatus } from "@/app/api/cache";
import { Suspense } from "react";
import { Link, usePathname } from "@/i18n/routing";
import MainWrapper from "./MainWrapper";
import Banner from "./Banner";
import { GoogleAnalytics } from '@next/third-parties/google'

const ubuntu = Ubuntu({
	subsets: ["latin"],
	weight: ["300", "400", "500", "700"],
	variable: "--font-ubuntu",
});

const montserrat = Montserrat({
	subsets: ["latin"],
	weight: ["300", "400", "500", "700"],
	variable: "--font-montserrat",
});

export default async function Base({
	children,
	locale,
}: Readonly<{
	children: React.ReactNode;
	locale: string;
}>) {
	const status = await getCachedStatus(true);
	const messages = await getMessages();
	const dir = getLangDir(locale);
	const session = await auth();
	const t = await getTranslations({ locale, namespace: "ui" });

	return (
		<html lang={locale} dir={dir} suppressHydrationWarning>
			<head>
				<link rel="unapi-server" type="application/xml" title="unAPI" href="/api/unapi" />
			</head>
			<body
				className={`${
					style === "wide" ? montserrat.className : ubuntu.className
				}`}
			>
				<NextIntlClientProvider messages={messages}>
					<Providers session={session} status={status}>
						<MainWrapper>
							<nav
								aria-label={t("skipNavAriaLabel")}
								className="absolute top-0 left-0 w-64 h-0"
							>
								<a
									href="#main-content"
									className="p-4 text-center w-1 h-1 absolute top-0 left-[-999px] z-[-999] focus:z-[999] focus:left-0 opacity-0 focus:w-fit focus:h-fit focus:opacity-100"
								>
									{t("skipToContent")}
								</a>
								<a
									href="#footer"
									className="p-4 text-center w-1 h-1 absolute top-0 left-[-999px] z-[-999] focus:z-[999] focus:left-0 opacity-0 focus:w-fit focus:h-fit focus:opacity-100"
								>
									{t("skipToFooter")}
								</a>
							</nav>
							<Navbar />
							{children}
							<Footer />
							<Banner />
							<GoogleAnalytics gaId={process.env.GOOGLE_ANALYTICS_ID || ""} />
						</MainWrapper>
					</Providers>
				</NextIntlClientProvider>
				<Analytics />
			</body>
		</html>
	);
}
