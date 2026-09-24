"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { MapsIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
import { useGapMaps } from "@/context/Providers";
import { Link } from "@/i18n/routing";
import type { NavbarStyleVariant } from "@/types/navbar";

interface GapMapLinksProps {
	pathname: string;
	isMobile: boolean;
	styleVariant: NavbarStyleVariant;
	onNavigate?: () => void;
}

export default function GapMapLinks({
	pathname,
	isMobile,
	styleVariant,
	onNavigate,
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
				onNavigate={onNavigate}
				data-is-mobile={isMobile}
				className={twMerge(
					"flex gap-2 text-lg items-center justify-center font-medium",
					styleVariant === "wide" && "uppercase font-base"
				)}
			>
				<HugeiconsIcon icon={MapsIcon} className={twMerge("size-6 shrink-0", styleVariant === "wide" && "size-5")} />
				<span className="line-clamp-1">{t("gapMaps")}</span>
			</Link>
		</li>
	);
}
