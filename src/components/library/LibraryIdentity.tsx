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
import { RuntimeAsset } from "@/components/library/RuntimeAsset";
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
const BRAND_LOGO_IMAGE_CLASS = "h-full w-auto object-contain";

/**
 * A slot of a fixed height for a logo. Give it the height its bar has room
 * for. A square, wide or tall image file then always draws at that height
 * instead of opening the bar to its own pixel size.
 */
function BrandLogoBox({
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
 * How tall the library's own logo is drawn in each place, and how wide the
 * box lets it grow. The image never sets its own width, so the cap here is
 * the only thing that can stop a very wide logo.
 */
const LIBRARY_LOGO_SIZES = {
	admin: "h-7 max-w-full",
	cookie: "h-8 max-w-logo-cookie",
	footer: "h-12 max-w-logo-footer",
	// The header shrinks before the navigation does, so a wide logo can never
	// push the buttons beside it off the bar.
	header: "h-9 min-w-0 max-w-logo-header shrink xl:h-10",
} as const;

export type LibraryLogoPlace = keyof typeof LIBRARY_LOGO_SIZES;

/** The library's own logo, drawn inside the box its bar allows. */
export function LibraryLogo({
	className,
	onLoad,
	place,
}: {
	className?: string;
	onLoad?: () => void;
	place: LibraryLogoPlace;
}) {
	return (
		<BrandLogoBox
			className={twMerge(LIBRARY_LOGO_SIZES[place], className)}
			place={place}
		>
			<LibraryLogoImages
				className={twMerge(BRAND_LOGO_IMAGE_CLASS, "max-w-full")}
				onLoad={onLoad}
			/>
		</BrandLogoBox>
	);
}

/**
 * The sizes an institution's logo is drawn at: a small mark in a suggestion
 * row, a badge beside a line of text, and the square on a record page.
 */
const INSTITUTION_LOGO_SIZES = {
	badge: {
		box: "size-6 justify-center",
		image: "rounded-md bg-white/80 p-0.5",
	},
	small: {
		box: "size-4 justify-center",
		image: "rounded bg-white/80 p-0.5",
	},
	row: {
		box: "size-8 justify-center rounded-lg bg-accent/10 text-lg text-accent brightness-150",
		image: "rounded-lg bg-white p-1",
	},
} as const;

/**
 * An institution's logo in its own square box. Without a logo it shows the
 * fallback, or nothing when the caller has none.
 */
export function InstitutionLogo({
	alt,
	className,
	fallback,
	logoUrl,
	size = "badge",
}: {
	alt: string;
	className?: string;
	fallback?: ReactNode;
	logoUrl?: string;
	size?: keyof typeof INSTITUTION_LOGO_SIZES;
}) {
	if (!logoUrl && !fallback) return null;
	const shape = INSTITUTION_LOGO_SIZES[size];

	return (
		<BrandLogoBox
			className={twMerge(shape.box, className)}
			place="institution"
		>
			{logoUrl ? (
				<RuntimeAsset
					alt={alt}
					className={twMerge(
						BRAND_LOGO_IMAGE_CLASS,
						"max-w-full",
						shape.image,
					)}
					height={32}
					reference={logoUrl}
					width={32}
				/>
			) : (
				fallback
			)}
		</BrandLogoBox>
	);
}

/** A funder's logo in the footer, inside the box the footer row allows. */
export function FunderLogo({
	alt,
	logoUrl,
}: {
	alt: string;
	logoUrl: string;
}) {
	return (
		<BrandLogoBox
			className="h-12 max-w-logo-funder justify-center rounded-md bg-white"
			place="funder"
		>
			<RuntimeAsset
				alt={alt}
				className={twMerge(BRAND_LOGO_IMAGE_CLASS, "max-w-full p-1")}
				height={48}
				reference={logoUrl}
				width={160}
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
