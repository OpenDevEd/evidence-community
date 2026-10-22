"use client";

import { Fragment, useState, type Ref } from "react";
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
export function TitlePage({ title, site, className }: { title?: string; /** Where the PDF is, set above the title like a publisher's line. */ site?: string; className?: string }) {
	return (
		<div aria-hidden className={twMerge("@container relative flex aspect-[3/4] w-full flex-col overflow-hidden rounded-xl bg-[#fbf8f2] p-[10%] text-[#2b2521] ring-1 ring-inset ring-black/[0.06]", className)}>
			<span className="h-[2.5cqw] w-1/4 shrink-0 rounded-full bg-accent" />
			{site ? (
				// A long name breaks after a dot. A page narrower than 80 px has no room for one, so the title stands alone there. The
				// page is measured, not this sheet's own container, whose padding leaves it a fifth narrower.
				<span className="mt-[7cqw] hidden text-[length:max(8px,7.5cqw)] font-medium leading-tight text-[#2b2521]/55 @[80px]/pdf:block">
					{site.split(".").map((part, index) => <Fragment key={index}>{index > 0 && <>.<wbr /></>}{part}</Fragment>)}
				</span>
			) : null}
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
 * A PDF the library only links to: a reader opens it on the site that holds it. The library has no picture of its first page,
 * so a title page stands in with the site set above the title, and a frosted open-elsewhere mark sits in its corner, as on a
 * link preview: a PDF the library holds has no mark.
 */
export function OnlinePdf({ url, title, onOpen, className }: { url: string; title?: string; onOpen?: () => void; className?: string }) {
	const t = useTranslations("ui");
	const site = siteOf(url);
	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			onClick={onOpen}
			aria-label={t("pdfOnline", { site })}
			className={twMerge("@container/pdf relative block overflow-hidden outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent", className)}
		>
			<TitlePage title={title} site={site} className="rounded-none dark:brightness-[0.94]" />
			<span className="absolute bottom-[7%] end-[7%] flex size-[max(18px,22cqw)] items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md">
				<HugeiconsIcon icon={LinkSquare01Icon} className="size-[55%]" />
			</span>
		</a>
	);
}
