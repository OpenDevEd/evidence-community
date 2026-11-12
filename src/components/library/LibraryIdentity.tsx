"use client";

/* Logos stay plain images so their loading can be watched from the first paint; their files still reach Next's optimizer through /brand. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useState, type ReactNode } from "react";
import { getImageProps } from "next/image";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { twMerge } from "@/lib/tw-merge";

import { LIBRARY_LOGO_ATTRIBUTES } from "@/config/library-config/identity";
import { RuntimeAsset } from "@/components/library/RuntimeAsset";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

/**
 * Which logo file is on screen right now, and whether that exact file has
 * already settled — arrived, or failed for good.
 *
 * A library ships a light and a dark logo, and switching between light and
 * dark swaps which one is shown. Every file that settles is remembered, so a
 * colour scheme that has been shown once never asks the bar to hold room for
 * it again. Readiness is worked out while the page is being drawn, so it
 * cannot flicker for a frame after a switch. Files are remembered with their
 * colour scheme: one address used for both is two differently sized files.
 */
export function useLibraryLogo() {
	const { identity } = useLibraryConfig();
	const { resolvedTheme } = useTheme();
	const [settledSources, setSettledSources] = useState<ReadonlySet<string>>(
		() => new Set<string>(),
	);
	const shownSource =
		resolvedTheme === "dark"
			? `dark:${identity.assets.logoDark}`
			: `light:${identity.assets.logoLight}`;
	const onLogoSettled = useCallback((source: string) => {
		setSettledSources((current) =>
			current.has(source) ? current : new Set(current).add(source),
		);
	}, []);

	return { isLoaded: settledSources.has(shownSource), onLogoSettled };
}

/**
 * The library's light and dark logo files. Deliberately not exported: every
 * logo on the site must go through a box below, which owns its height.
 */
function LibraryLogoImages({
	className,
	onSettled,
}: {
	className?: string;
	onSettled?: (source: string) => void;
}) {
	const { identity } = useLibraryConfig();
	/**
	 * Both files are reported, not only the one on screen. The hidden one is
	 * the picture the other colour scheme uses, and remembering it is what
	 * stops the bar holding room for it a second time.
	 */
	return (
		<>
			<LogoImage
				source={identity.assets.logoLight}
				theme="light"
				className={twMerge("dark:hidden", className)}
				onSettled={onSettled}
			/>
			<LogoImage
				source={identity.assets.logoDark}
				theme="dark"
				className={twMerge("hidden dark:block", className)}
				onSettled={onSettled}
			/>
		</>
	);
}

/** Wide enough for the widest logo box (the home page's, 18rem); Next picks the 1x and 2x files from it. */
const LOGO_WIDTH = 288;

/**
 * One logo file, reported by its configured address once it arrives or fails.
 * A PNG or WebP goes through Next's optimizer by way of /brand, at the size it
 * is drawn; any other file, or one the optimizer cannot serve, loads from its
 * own address.
 */
function LogoImage({
	source,
	theme,
	className,
	onSettled,
}: {
	source: string;
	theme: "light" | "dark";
	className: string;
	onSettled?: (source: string) => void;
}) {
	const { identity, revision } = useLibraryConfig();
	const t = useTranslations("ui");
	const [direct, setDirect] = useState(false);
	// Only a PNG or WebP at a full address can be resized; an SVG, or anything else, loads as it is.
	const extension = URL.canParse(source) ? new URL(source).pathname.match(/\.(png|webp)$/iu)?.[0] : undefined;
	const optimized =
		direct || !extension
			? null
			: getImageProps({
					// The extension keeps the address out of the proxy, which takes every path without one.
					src: `/brand/${encodeURIComponent(revision)}/logo-${theme}${extension}`,
					alt: "",
					width: LOGO_WIDTH,
					height: LOGO_WIDTH,
				}).props;
	const throughOptimizer = optimized !== null;
	const settle = useCallback(() => onSettled?.(`${theme}:${source}`), [onSettled, source, theme]);
	/**
	 * A picture that was already in the browser's store finishes before the
	 * page is wired up, so its load or error event never reaches us. Ask it as
	 * it is put on the page, which happens before anything is drawn.
	 */
	const checkAlreadyThere = useCallback(
		(element: HTMLImageElement | null) => {
			if (!element?.complete) return;
			if (throughOptimizer && element.naturalWidth === 0) setDirect(true);
			else settle();
		},
		[throughOptimizer, settle],
	);

	return (
		<img
			{...LIBRARY_LOGO_ATTRIBUTES}
			ref={checkAlreadyThere}
			alt={t("logoAlt", { company: identity.name, theme })}
			className={className}
			onError={() => (optimized ? setDirect(true) : settle())}
			onLoad={settle}
			src={optimized?.src ?? source}
			srcSet={optimized?.srcSet}
		/>
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
			// Nothing is drawn outside this box. A library's own logo CSS is
			// already limited to what stays inside the picture, and this is
			// the backstop if one of those checks is ever wrong.
			className={twMerge(
				"flex shrink-0 items-center overflow-hidden",
				className,
			)}
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
	admin: "h-7 max-w-logo-admin",
	cookie: "h-8 max-w-logo-cookie",
	footer: "h-12 max-w-logo-footer",
	// The header shrinks before the navigation does, so a wide logo can never
	// push the buttons beside it off the bar.
	header: "h-9 min-w-0 max-w-logo-header shrink xl:h-10",
	// The home page's hero, above the library's name: the one place the logo is shown large.
	hero: "h-12 max-w-[18rem] sm:h-14",
} as const;

/** OpenScholar's own logo stands in until a library uploads one; it is served from the platform's folder. */
export function hasOwnLogo(assets: { logoLight?: string; logoDark: string }) {
	return ![assets.logoLight, assets.logoDark].some((source) => source?.includes("/openscholar/platform/"));
}

type LibraryLogoPlace = keyof typeof LIBRARY_LOGO_SIZES;

/** The library's own logo, drawn inside the box its bar allows. */
export function LibraryLogo({
	className,
	onSettled,
	place,
}: {
	className?: string;
	onSettled?: (source: string) => void;
	place: LibraryLogoPlace;
}) {
	return (
		<BrandLogoBox
			className={twMerge(LIBRARY_LOGO_SIZES[place], className)}
			place={place}
		>
			<LibraryLogoImages
				className={twMerge(BRAND_LOGO_IMAGE_CLASS, "max-w-full")}
				onSettled={onSettled}
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
			place={`institution-${size}`}
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
