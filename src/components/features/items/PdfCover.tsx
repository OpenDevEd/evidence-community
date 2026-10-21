"use client";

import { useState, type Ref } from "react";
import { preload } from "react-dom";
import { getImageProps } from "next/image";
import { CoverImage, optimizedCover } from "./CoverImage";
import { Skeleton } from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { LinkSquare01Icon } from "@hugeicons/core-free-icons";
import type { Item, ListItem } from "@/app/api/item/types";

/**
 * A publication's first page, as the library extracted it from its PDF; without one, a plain title page stands in.
 * `sizes` is how wide it is drawn (a publication page's by default). A cover always drawn at one `width` in CSS pixels
 * says so instead: its image then offers two copies, for normal and sharp screens, rather than every size there is.
 */
const PAGE_SIZES = "(min-width: 640px) 208px, 330px";

/**
 * Starts loading an item's covers at the size its page draws them, when a reader points at a link to it, so the page
 * opens with the covers instead of placeholders.
 */
export function preloadItemCovers(item: Item | ListItem | undefined) {
	for (const { PDFCoverPageImage: src } of item?.attachmentsData ?? []) {
		if (!src) continue;
		const optimized = optimizedCover(src);
		if (!optimized) {
			preload(src, { as: "image" });
			continue;
		}
		const { props } = getImageProps({ src: optimized, alt: "", width: 512, height: 512, sizes: PAGE_SIZES });
		preload(props.src, { as: "image", imageSrcSet: props.srcSet, imageSizes: props.sizes });
	}
}

export function PdfCover({ src, alt, ref, onLoad, className, sizes = PAGE_SIZES, width, title }: { src?: string | null; alt: string; ref?: Ref<HTMLImageElement>; onLoad?: () => void; className?: string; sizes?: string; width?: number; /** Set on the stand-in page when there is no first page. */ title?: string }) {
	const [loaded, setLoaded] = useState(false);
	if (!src) return <TitlePage title={title} className={className} />;
	return (
		// NextUI shows a skeleton's content once any skeleton around it has loaded, so inside another loaded one the cover
		// would appear before its image and pop in; it stays hidden until its own image is ready, then fades in.
		<Skeleton isLoaded={loaded} className="w-full rounded-xl" classNames={{ content: loaded ? undefined : "!opacity-0" }}>
			<CoverImage
				ref={(element) => {
					// A cover the browser already holds, for example when the item page draws it again after its quick first
					// render, is complete as soon as it is attached: show it before the first paint instead of the placeholder.
					if (element?.complete && element.naturalWidth > 0) setLoaded(true);
					if (typeof ref === "function") ref(element);
					else if (ref) ref.current = element;
				}}
				src={src}
				alt={alt}
				width={width ?? 512}
				height={width ?? 512}
				sizes={width ? undefined : sizes}
				onLoad={() => {
					setLoaded(true);
					onLoad?.();
				}}
				className={twMerge("w-full rounded-xl bg-accent", className)}
			/>
		</Skeleton>
	);
}

/** A sheet of paper with the title set at its head and a few lines of text, sized to whatever width it is drawn at. */
function TitlePage({ title, className }: { title?: string; className?: string }) {
	return (
		<div aria-hidden className={twMerge("@container relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-xl bg-[#fbf8f2] p-[10%] text-[#2b2521] ring-1 ring-inset ring-black/[0.06]", className)}>
			<span className="h-[2.5cqw] w-1/4 shrink-0 rounded-full bg-accent" />
			{title ? <span className="mt-[9cqw] line-clamp-5 font-heading text-[length:9cqw] font-semibold leading-[1.18] tracking-tight">{title}</span> : null}
			<span className="mt-auto flex flex-col gap-[4cqw]">
				{["100%", "100%", "86%", "58%"].map((lineWidth, index) => (
					<span key={index} className="h-[2.2cqw] rounded-full bg-[#2b2521]/[0.09]" style={{ width: lineWidth }} />
				))}
			</span>
		</div>
	);
}

/**
 * The site a linked PDF opens on, as a reader knows it: its main domain, "ucf.edu" for stars.library.ucf.edu, keeping a
 * country's second level ("ox.ac.uk").
 * ponytail: a short second-to-last label stands for the public suffix list; a site such as "abc.xy" keeps one label too few.
 */
function siteOf(url: string) {
	let labels: string[];
	try {
		labels = new URL(url).hostname.split(".");
	} catch {
		return url;
	}
	const countrySecondLevel = labels.length > 2 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3;
	return labels.slice(countrySecondLevel ? -3 : -2).join(".");
}

/**
 * A PDF the library only links to: a reader opens it on the site that holds it, and the library can't show its first page.
 * An outline of a page rather than a page, with no shadow, the open-elsewhere mark and the site's name, so it never passes for
 * a PDF the library holds. Its marks scale with its own width.
 */
export function OnlinePdf({ url, className }: { url: string; className?: string }) {
	const t = useTranslations("ui");
	const site = siteOf(url);
	return (
		<div role="img" aria-label={t("pdfOnline", { site })} className={twMerge("@container/pdf flex aspect-[3/4] w-full flex-col items-center justify-center gap-1.5 border border-dashed border-black/25 px-1.5 text-black/50 dark:border-white/25 dark:text-white/55", className)}>
			<HugeiconsIcon icon={LinkSquare01Icon} className="size-[30cqw] max-h-8 max-w-8 shrink-0" />
			<span className="hidden w-full truncate text-center text-[11px] font-medium leading-tight @[72px]/pdf:block">{site}</span>
		</div>
	);
}
