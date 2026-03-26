"use client";

import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { useGapMaps } from "@/context/Providers";
import { BsMapFill } from "react-icons/bs";
import { Link } from "@/i18n/routing";
import type { NavbarStyleVariant } from "@/types/navbar";

interface GapMapLinksProps {
	pathname: string;
	isMobile: boolean;
	styleVariant: NavbarStyleVariant;
}

export default function GapMapLinks({
	pathname,
	isMobile,
	styleVariant,
}: GapMapLinksProps) {
	const t = useTranslations("nav");
	const gapmaps = useGapMaps();

	if (!gapmaps.length) return null;

	const isActive = pathname.includes("/gapmap");

	return (
		<li
			className={twMerge(
				"flex items-center text-black/60 dark:text-white/60",
				isActive && "text-accent dark:text-accent"
			)}
		>
			<Link
				href="/gapmaps"
				data-is-mobile={isMobile}
				className={twMerge(
					"flex gap-2 text-lg items-center justify-center font-medium",
					styleVariant === "wide" && "uppercase font-base"
				)}
			>
				<BsMapFill className={twMerge("fill-current size-6 shrink-0", styleVariant === "wide" && "size-5")} />
				<span className="line-clamp-1">{t("gapMaps")}</span>
			</Link>
		</li>
	);
}
