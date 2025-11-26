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
import {
	convertStringFromDatabaseToObject,
	getDynamicStyles,
	localizeOrUseIfCapitalized,
} from "@/lib/utils";
import { LinkObject } from "@/db/schema/tables/status";
import { FaLinkedin, FaTwitter, FaYoutube } from "react-icons/fa";
import { RiBlueskyFill } from "react-icons/ri";

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
	const { resolvedTheme: theme } = useTheme();
	const t = useTranslations("ui");
	const companyLogoStyle = convertStringFromDatabaseToObject(
		status.companyLogo || ""
	)["footer"];

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
						company: status?.companyName || "",
						theme: themeToMatch,
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

function SocialWrapper({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={twMerge(
				"rounded-full  flex justify-center items-center p-3",
				className
			)}
		>
			{children}
		</div>
	);
}

const socials = {
	twitter: (
		<SocialWrapper className="bg-[rgb(29,161,242)]">
			<FaTwitter className="fill-white" />
		</SocialWrapper>
	),
	linkedin: (
		<SocialWrapper className="bg-[rgb(0,119,181)]">
			<FaLinkedin className="fill-white" />
		</SocialWrapper>
	),
	youtube: (
		<SocialWrapper className="bg-[rgb(205,32,31)]">
			<FaYoutube className="fill-white" />
		</SocialWrapper>
	),
	bluesky: (
		<SocialWrapper className="bg-[rgb(0,121,212)]">
			<RiBlueskyFill className="fill-white" />
		</SocialWrapper>
	),
};

export default function Footer() {
	const t = useTranslations("footer");
	const tNav = useTranslations("nav");
	const [isMounted, setIsMounted] = useState(false);
	const { resolvedTheme: theme } = useTheme();
	const status = useStatus();
	const pathname = usePathname();
	const links = status.links || [];
	const footer = status.companyFooter || {};
	const isMapPage = pathname.includes("/map");
	const socialLinks = Object.entries(status.externalLinks || {});

	useEffect(() => {
		setIsMounted(true);
	}, []);

	const contactData = links.find((link) => link.id === "contact");

	if (status.companyName === "EdTech Hub") {
		const footerItems = links.reduce(
			(acc: Record<string, LinkObject[]>, link) => {
				const section = link.section || "Site";
				if (!acc[section]) {
					acc[section] = [];
				}
				if (!link.footerExclude) {
					acc[section].push(link);
				}
				return acc;
			},
			{}
		);
		const footerItemsSorted = Object.entries(footerItems).sort((a, b) => {
			// sort by their order of appearance in the links array
			return (
				links.findIndex((link) => link.section === a[0]) -
				links.findIndex((link) => link.section === b[0])
			);
		});

		return (
			!isMapPage && (
				<footer
					id="footer"
					className="relative row-start-3 bg-white dark:bg-card w-full print:hidden flex justify-center items-center"
				>
					<div className="max-w-[96rem] px-0 flex w-full flex-col py-28 gap-52">
						<div className="flex flex-col gap-6 px-14">
							<div className="grid grid-cols-1 gap-6 lg:grid-cols-3 w-full">
								{footerItemsSorted.map(([section, links]) => (
									<div
										key={section}
										className="flex flex-col gap-6"
									>
										<h3 className="text-black/80 dark:text-white/80 font-bold text-3xl">
											{section}
										</h3>
										<ul className="flex flex-col gap-4">
											{links.map((link) => (
												<li key={link.label}>
													<Link
														href={link.href}
														className="text-black/60 dark:text-white/60 text-xl"
													>
														{localizeOrUseIfCapitalized(
															link.label,
															tNav
														)}
													</Link>
												</li>
											))}
										</ul>
									</div>
								))}
							</div>
							<div className="flex lg:grid grid-cols-3 gap-6 w-full">
								<div></div>
								<div></div>
								<div className="flex gap-4">
									{socialLinks
										.filter(
											([key]) =>
												socials[
													key as keyof typeof socials
												]
										)
										.map(([key, value]) => (
											<Link href={value} key={key}>
												{
													socials[
														key as keyof typeof socials
													]
												}
											</Link>
										))}
								</div>
							</div>
						</div>
						<div className="w-full flex lg:flex-row flex-col justify-between items-end lg:items-center gap-8 overflow-hidden px-14">
							<div className="text-black/60 dark:text-white/60 text-2xl font-bold shrink-0">
								EdTech Hub is supported by
							</div>
							<div className="flex-1">
								<Image
									src="/assets/edtechfooter.webp"
									alt="EdTech Hub"
									width={1185}
									height={124}
									className="w-full h-full object-contain"
								/>
							</div>
						</div>
						<div className="w-full flex justify-center items-center text-[11px] text-center px-4">
							The findings, interpretations, and conclusions
							expressed in the content on this site do not
							necessarily reflect the views of The UK government,
							Bill & Melinda Gates foundation or the World Bank,
							the Executive Directors of the World Bank, or the
							governments they represent.
						</div>
						<div className="w-full text-center px-4">
							<a
								href="https://edtechhub.org"
								className="text-accent underline"
							>
								EDTECH HUB 2025
							</a>
							. Creative Commons Attribution 4.0 International
							License.
						</div>
						<Link
							href="https://opendeved.org"
						>
							<div className="flex w-full justify-center items-center gap-4">
								Powered by
								<div>
									<Image
										src="/logos/opendeved/logo_light.png"
										className="dark:hidden"
										alt="EdTech Hub"
										width={128}
										height={32}
									/>
									<Image
										src="/logos/opendeved/logo.png"
										className="hidden dark:block"
										alt="EdTech Hub"
										width={128}
										height={32}
									/>
								</div>
							</div>
						</Link>
					</div>
				</footer>
			)
		);
	}

	return (
		!isMapPage && (
			<footer
				id="footer"
				className="relative row-start-3 bg-white dark:bg-card h-full w-full flex justify-center items-center flex-col gap-6 lg:gap-14 py-12 min-h-[32rem] lg:py-0 print:hidden"
			>
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
													{localizeOrUseIfCapitalized(
														link.label,
														tNav
													)}
												</Link>
											</li>
										)
								)}
							</ul>
						}
					/>
					<div className="flex flex-col h-full gap-6 w-full lg:w-auto">
						{socialLinks.length > 0 && (
							<FooterFieldColumn
								title={t("stayConnected")}
								content={
									<div className="flex mt-6 gap-8">
										{socialLinks.map((link) => (
											<Link href={link[1]} key={link[0]}>
												{
													socials[
														link[0] as keyof typeof socials
													]
												}
											</Link>
										))}
									</div>
								}
							/>
						)}
						<FooterFieldColumn
							title={t("contactUs")}
							content={
								<div className="mt-6">
									<Button
										as={Link}
										href={contactData?.href || ""}
										color={
											isMounted && theme === "light"
												? "accent"
												: undefined
										}
										className="px-12"
									>
										{contactData?.label
											? localizeOrUseIfCapitalized(
													contactData.label,
													tNav
											  )
											: t("contactUs")}
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
				<div className="absolute bottom-0 left-0 p-2 z-50 text-xs text-black/60 dark:text-white/60">
					0.6.1
				</div>
			</footer>
		)
	);
}
