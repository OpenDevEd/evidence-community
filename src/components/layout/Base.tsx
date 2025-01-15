import type { Metadata } from "next";
import Providers from "@/context/Providers";
import { Montserrat, Ubuntu } from "next/font/google";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { Analytics } from "@vercel/analytics/react";
import { twMerge } from "tailwind-merge";
import { style } from "@/../tailwind.config";
import { getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import {getLangDir} from 'rtl-detect';
import { authOptions, auth } from "@/app/api/auth/[...nextauth]/config";
import { db } from "@/db";
import { status as statusTable } from "@/db/schema/tables/status";
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
	const status = await db.select().from(statusTable)
	const messages = await getMessages();
	const dir = getLangDir(locale);
	const session = await auth();

	return (
		<html lang={locale} dir={dir} suppressHydrationWarning>
			<body
				className={`${
					style === "edtechhub"
						? montserrat.className
						: ubuntu.className
				}`}
			>
				<NextIntlClientProvider messages={messages}>
					<Providers session={session} status={status[0] as any}>
						<div
							className={twMerge(
								"h-full w-full bg-background_light dark:bg-background flex flex-col xl:grid xl:grid-rows-[6.5rem_1fr_32rem] gap-4 xl:gap-14 items-center justify-items-center min-h-screen",
								style === "opendeved" && "xl:pt-14"
							)}
						>
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
