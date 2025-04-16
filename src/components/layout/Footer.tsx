"use client";
import Image from "next/image";
import { socialLinks } from "@/constants/links";
import { Button } from "@/components/nextui/Button";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { useState } from "react";
import { style } from "@/../tailwind.config";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link } from "@/i18n/routing";
import { twMerge } from "tailwind-merge";
import { useStatus } from "@/context/Providers";
import { usePathname } from "next/navigation";
import { convertStringFromDatabaseToObject, getDynamicStyles } from "@/lib/utils";
const footerInfo = {
	email: "opendeved@gmail.com",
	phone: "+1-123-456-7890",
	address: "123 Creativity Lane, Designville",
};

function FooterFieldColumn({
	title,
	content,
}: {
	title: string;
	content: React.ReactNode;
}) {
	return (
		<div className="flex flex-col w-full lg:w-auto items-center lg:items-start">
			<h3 className="text-black/80 dark:text-white/80 font-bold text-xl">
				{title}
			</h3>
			{content}
		</div>
	);
}

function Logo() {
	const [isLoaded, setIsLoaded] = useState(false);
	const status = useStatus();
	const { theme } = useTheme();
	const t = useTranslations("ui");
	const companyLogoStyle = convertStringFromDatabaseToObject(status.companyLogo || "")["footer"];

	return (
		<Skeleton
			isLoaded={isLoaded}
			className={twMerge(
				"w-[14.5rem] h-[3.375rem] rounded-lg",
				companyLogoStyle
			)}
		>
			{["dark", "light"].map((themeToMatch) => (
				<Image
					key={themeToMatch}
					aria-hidden={themeToMatch !== theme}
					alt={t("logoAlt", { 
						company: status?.companyName,
						theme: themeToMatch 
					})}
					onLoad={() => setIsLoaded(true)}
					className={twMerge(
						themeToMatch === "light"
							? "dark:hidden"
							: "hidden dark:block"
					)}
					suppressHydrationWarning
					src={`/logos/${status?.companyName?.toLowerCase()}/logo${
						themeToMatch === "light" ? "_light" : ""
					}.png`}
					width={232}
					height={54}
					style={{ ...getDynamicStyles(companyLogoStyle) }}
				/>
			))}
		</Skeleton>
	);
}

export default function Footer() {
	const t = useTranslations("footer");
	const tNav = useTranslations("nav");
	const [isMounted, setIsMounted] = useState(false);
	const { theme } = useTheme();
	const status = useStatus();
	const pathname = usePathname();
	const links = status.links || [];
	const footer = status.companyFooter || {};
	const isMapPage = pathname.includes("/map");

	useEffect(() => {
		setIsMounted(true);
	}, []);

	return (
		!isMapPage && <footer id="footer" className="relative row-start-3 bg-white dark:bg-card h-full w-full flex justify-center items-center flex-col gap-6 lg:gap-14 py-12 min-h-[32rem] lg:py-0 print:hidden">
			<div className="max-w-[96rem] px-14 flex w-full justify-between lg:items-start items-center flex-col gap-6 lg:gap-14 lg:flex-row">
				<div className="flex flex-col gap-6 h-full items-center lg:items-start">
					<Logo />
					<div className="flex flex-col gap-[0.875rem]">
						{Object.entries(footerInfo).map(
							([key, value]) =>
								footer[key] && (
									<div
										key={key}
										className="flex gap-2 justify-center lg:justify-start"
									>
										<span className="text-black/60 dark:text-white/60">
											{t(key)}
										</span>
										<span className="text-black/60 dark:text-white/60 font-bold break-all text-wrap">
											{footer[key]}
										</span>
									</div>
								)
						)}
					</div>
				</div>
				<FooterFieldColumn
					title={t("quickLinks")}
					content={
						<ul className="flex flex-col gap-4 mt-6 items-center lg:items-start">
							{links.map(
								(link) =>
									!link.footerExclude && (
										<li key={link.label}>
											<Link
												href={link.href}
												key={link.label}
												className="text-black/60 dark:text-white/60 text-xl"
										>
												{tNav(link.label)}
											</Link>
										</li>
									)
							)}
						</ul>
					}
				/>
				<div className="flex flex-col h-full gap-6 w-full lg:w-auto">
					{false &&<FooterFieldColumn
						title={t("stayConnected")}
						content={
							<div className="flex mt-6 gap-8">
								{socialLinks.map((link) => (
									<Link href={link.href} key={link.label}>
										<link.icon className="text-black/60 dark:text-white/60 w-6 h-6" />
									</Link>
								))}
							</div>
						}
					/>}
					<FooterFieldColumn
						title={t("contactUs")}
						content={
							<div className="mt-6">
								<Button
									as={Link}
									href={status.externalLinks?.contact || ""}
									color={
										isMounted && theme === "light"
											? "accent"
											: undefined
									}
									className="px-12"
								>
									{tNav("contactUs")}
								</Button>
							</div>
						}
					/>
				</div>
			</div>
			{(footer.privacyPolicy || footer.termsOfService) && (
				<div className="flex gap-4">
					{footer.privacyPolicy && (
							<Link
								href={footer.privacyPolicy}
								className="text-black/60 dark:text-white/60 font-medium"
							>
								{t("privacyPolicy")}
							</Link>
						)}
						<span className="font-medium text-black/60 dark:text-white/60 first:hidden last:hidden">
							|
						</span>
						{footer.termsOfService && (
							<Link
								href={footer.termsOfService}
								className="text-black/60 dark:text-white/60 font-medium"
							>
								{t("termsOfService")}
							</Link>
					)}
				</div>
			)}
			<div className="absolute bottom-0 right-0 p-2 z-50 text-xs text-black/60 dark:text-white/60">
					0.2.3
			</div>
		</footer>
	);
}

