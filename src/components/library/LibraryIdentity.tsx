"use client";

/* Runtime asset hosts cannot be known to next/image at build time. */
/* eslint-disable @next/next/no-img-element */

import {
	useCallback,
	useEffect,
	useRef,
	type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";

import { LIBRARY_LOGO_ATTRIBUTES } from "@/config/library-config/identity";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

export function LibraryLogoImages({
	className,
	onLoad,
}: {
	className?: string;
	onLoad?: () => void;
}) {
	const { identity } = useLibraryConfig();
	const t = useTranslations("ui");
	const lightLogoRef = useRef<HTMLImageElement>(null);
	const darkLogoRef = useRef<HTMLImageElement>(null);
	const hasReportedReady = useRef(false);
	const reportReady = useCallback(() => {
		if (hasReportedReady.current) return;
		hasReportedReady.current = true;
		onLoad?.();
	}, [onLoad]);

	useEffect(() => {
		if (
			lightLogoRef.current?.complete ||
			darkLogoRef.current?.complete
		) {
			reportReady();
		}
	}, [reportReady]);

	return (
		<>
			<img
				{...LIBRARY_LOGO_ATTRIBUTES}
				ref={lightLogoRef}
				alt={t("logoAlt", {
					company: identity.name,
					theme: "light",
				})}
				className={twMerge("dark:hidden", className)}
				onError={reportReady}
				onLoad={reportReady}
				src={identity.assets.logoLight}
			/>
			<img
				{...LIBRARY_LOGO_ATTRIBUTES}
				ref={darkLogoRef}
				alt={t("logoAlt", {
					company: identity.name,
					theme: "dark",
				})}
				className={twMerge("hidden dark:block", className)}
				onError={reportReady}
				onLoad={reportReady}
				src={identity.assets.logoDark}
			/>
		</>
	);
}

/**
 * The rules every logo image carries. The box around it owns the height. The
 * image fills that height, keeps its shape, and is never cut off.
 *
 * No display rule belongs here. The light and dark copies of a logo switch
 * each other off with `hidden`, and a display rule added later would win and
 * show both at once.
 */
export const BRAND_LOGO_IMAGE_CLASS = "h-full w-auto object-contain";

/**
 * A slot of a fixed height for a logo. Give it the height its bar has room
 * for. A square, wide or tall image file then always draws at that height
 * instead of opening the bar to its own pixel size.
 */
export function BrandLogoBox({
	children,
	className,
	place,
}: {
	children: ReactNode;
	className?: string;
	place: string;
}) {
	return (
		<span
			className={twMerge("flex shrink-0 items-center", className)}
			data-brand-logo-box={place}
		>
			{children}
		</span>
	);
}

/**
 * How tall the library's own logo is drawn in each place, and how wide it may
 * grow before the width is capped.
 */
const BRAND_LOGO_SIZES = {
	cookie: { box: "h-8", image: "max-w-logo-cookie" },
	footer: { box: "h-12", image: "max-w-logo-footer" },
	header: { box: "h-9 xl:h-10", image: "max-w-logo-header" },
} as const;

export type BrandLogoPlace = keyof typeof BRAND_LOGO_SIZES;

/** The library's own logo, drawn inside the box its bar allows. */
export function BrandLogo({
	className,
	onLoad,
	place,
}: {
	className?: string;
	onLoad?: () => void;
	place: BrandLogoPlace;
}) {
	const size = BRAND_LOGO_SIZES[place];

	return (
		<BrandLogoBox className={twMerge(size.box, className)} place={place}>
			<LibraryLogoImages
				className={twMerge(BRAND_LOGO_IMAGE_CLASS, size.image)}
				onLoad={onLoad}
			/>
		</BrandLogoBox>
	);
}

export function FundingPartners({ className }: { className?: string }) {
	const { fundingPartners } = useLibraryConfig().identity;
	const t = useTranslations("ui");
	if (fundingPartners.length === 0) return null;

	return (
		<ul
			aria-label={t("fundingPartner")}
			className={twMerge("flex flex-wrap gap-x-3 gap-y-1", className)}
		>
			{fundingPartners.map((partner) => (
				<li key={partner.id}>{partner.name}</li>
			))}
		</ul>
	);
}
