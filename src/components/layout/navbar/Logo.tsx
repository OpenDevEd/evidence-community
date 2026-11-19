"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link } from "@/i18n/routing";
import { useStatus } from "@/context/Providers";
import {
	convertStringFromDatabaseToObject,
	getDynamicStyles,
	parseCompanyName,
} from "@/lib/utils";

interface LogoProps {
	interactive?: boolean;
	dbStyle?: string;
}

export function Logo({ interactive = true, dbStyle = "navbar" }: LogoProps) {
	const [isLoaded, setIsLoaded] = useState(false);
	// Cached images complete before hydration and never fire onLoad.
	const markLoadedIfComplete = useCallback((node: HTMLImageElement | null) => {
		// A broken/missing logo is also "done": never leave the skeleton
		// shimmering (an infinite compositor animation) for a 404.
		if (node?.complete) setIsLoaded(true);
	}, []);
	const status = useStatus();
	const { companyName } = parseCompanyName(status?.companyName);
	const t = useTranslations("ui");
	const companyLogoStyle = status.companyLogo || "";

	const navbarStyle = dbStyle
		? convertStringFromDatabaseToObject(companyLogoStyle)[dbStyle]
		: "";

	const links = status.links || [];
	const homeLink = links.find((link) => link.label === "home")?.href ?? "/";

	const logoContent = (
		<div
			className={twMerge(
				"select-none opacity-0 motion-safe:transition-[opacity,filter,transform] motion-safe:duration-500 motion-safe:ease-out motion-reduce:transition-none",
				isLoaded && "opacity-100",
				interactive &&
					"cursor-pointer hover:brightness-90 hover:scale-95 active:scale-105"
			)}
		>
			{["dark", "light"].map((themeToMatch) => (
				<Image
					data-component="navbar"
					key={themeToMatch}
					ref={markLoadedIfComplete}
					onLoad={() => setIsLoaded(true)}
					onError={() => setIsLoaded(true)}
					src={
						themeToMatch === "dark"
							? `/logos/${companyName.toLowerCase()}/logo.png`
							: `/logos/${companyName.toLowerCase()}/logo_light.png`
					}
					className={twMerge(
						"pointer-events-none",
						themeToMatch === "light" ? "dark:hidden" : "hidden dark:block"
					)}
					alt={t("logoAlt", {
						company: companyName,
						theme: themeToMatch,
					})}
					style={getDynamicStyles(navbarStyle)}
					height={300}
					width={300}
				/>
			))}
		</div>
	);

	return (
		<Skeleton
			isLoaded={true}
			className="w-[10.6875rem] h-[2.5rem] shrink-0 rounded-lg flex justify-center items-center"
		>
			{interactive ? <Link href={homeLink}>{logoContent}</Link> : logoContent}
		</Skeleton>
	);
}

export default Logo;
