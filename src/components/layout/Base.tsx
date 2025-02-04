import Providers from "@/context/Providers";
import { Montserrat, Ubuntu } from "next/font/google";
import Navbar from "@/components/layout/Navbar";
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
import { Link } from "@/i18n/routing";

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
			<body
				className={`${
					style === "wide" ? montserrat.className : ubuntu.className
				}`}
			>
				<NextIntlClientProvider messages={messages}>
					<Providers session={session} status={status}>
						<div
							className={twMerge(
								"h-full w-full bg-background_light dark:bg-background flex flex-col xl:grid xl:grid-rows-[6.5rem_1fr_32rem] items-center justify-items-center min-h-screen",
								style === "small" && "xl:pt-14"
							)}
						>
							<nav
								aria-label={"Skip navigation"}
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
						</div>
					</Providers>
				</NextIntlClientProvider>
				<Analytics />
			</body>
		</html>
	);
}
