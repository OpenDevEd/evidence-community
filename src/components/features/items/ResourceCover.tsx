"use client";

import { useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { Item, ListAttachment, ListItem } from "@/app/api/item/types";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { twMerge } from "@/lib/tw-merge";
import { CoverImage } from "./CoverImage";
import { OnlinePdf } from "./PdfCover";
import { pdfOpening, useTrackAttachment } from "./Attachment";

/** The record's PDFs a reader can open, stored or linked, in the order the item page lists them. */
export function resourcePdfs(item: Item | ListItem | undefined): ListAttachment[] {
	return item?.attachmentsData?.filter(isVisiblePdfAttachment) ?? [];
}

/** A page with no stored size is drawn as a portrait page. */
const PORTRAIT = 3 / 4;

/**
 * How wide a page of this shape is drawn, as a share of the card's cover width, so every page covers about the same area:
 * a portrait page takes the width, a landscape slide is wider and shorter, and no page is taller than one and a half widths.
 */
function widthShare(ratio: number) {
	if (ratio > 1) return Math.min(ratio, 1.5);
	return ratio < 2 / 3 ? ratio * 1.5 : 1;
}

// The cover's width follows the card's: a chat answer or a phone, a grid card, a list card. A card without an abstract, hidden
// or missing, is shorter, and so is its cover.
const COVER_WIDTH = {
	full: "[--cover:4rem] @[400px]:[--cover:5.5rem] @[560px]:[--cover:7rem] @[720px]:[--cover:8rem]",
	short: "[--cover:3.25rem] @[400px]:[--cover:4.25rem] @[560px]:[--cover:5rem] @[720px]:[--cover:5.75rem]",
};

/** The stack lifts with the card under the pointer and its shadow grows, settling back with the ease iOS uses for sheets. */
const EASE = "duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";
const LIFT = `transition-transform ${EASE} group-hover/card:-translate-y-1`;
const SHADOW = "shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_20px_-10px_rgb(0_0_0/0.3)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),0_10px_24px_-10px_rgb(0_0_0/0.8)]";
/** A press sinks the page at once and lets it settle back; the shadow keeps its slower ease. */
const PRESS = "[transition:box-shadow_500ms_cubic-bezier(0.32,0.72,0,1),transform_150ms_ease-out] motion-reduce:transition-none";
const SHADOW_LIFTED = `group-hover/card:shadow-[0_2px_4px_rgb(0_0_0/0.06),0_18px_36px_-14px_rgb(0_0_0/0.35)] dark:group-hover/card:shadow-[0_2px_4px_rgb(0_0_0/0.4),0_18px_36px_-12px_rgb(0_0_0/0.9)]`;
/** A hairline over the page's edge, so a white page still has one on a white card. */
const EDGE = "pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/[0.08] dark:ring-white/[0.1]";

/**
 * The record's PDF as its first page, at the card's trailing edge: what a reader gets before they open it. Several PDFs
 * stack, with their count beneath. A PDF the library links to but never stored has no first page, so a plain title page
 * stands in. A record without a PDF has no cover.
 */
export function ResourceCover({ pdfs, short, parentType }: { pdfs: ListAttachment[]; short: boolean; parentType: string | undefined }) {
	const t = useTranslations("ui");
	const track = useTrackAttachment(parentType);
	// A PDF the library holds goes in front of one it only links to.
	const front = pdfs.find((pdf) => pdf.PDFCoverPageImage) ?? pdfs[0];
	const stored = front.PDFCoverPageImage;
	const ratio = stored && front.PDFCoverPageWidth && front.PDFCoverPageHeight ? front.PDFCoverPageWidth / front.PDFCoverPageHeight : PORTRAIT;
	const stacked = pdfs.length > 1;
	// The cover opens its PDF in a new tab, as the item page's View and Open Document do; the rest of the card opens the record.
	const opening = pdfOpening(front);
	const open = () => track(opening.action, opening.source);
	return (
		<div className={twMerge("flex flex-col items-center gap-3 [grid-area:cover]", COVER_WIDTH[short ? "short" : "full"])}>
			{/* Only a page the library holds is a sheet of paper: it casts a shadow and lifts with the card. */}
			<div className={twMerge("relative isolate", stored && LIFT)} style={{ width: `calc(var(--cover) * ${widthShare(ratio)})` } as CSSProperties}>
				{stacked && <StackSheets more={pdfs.length - 1} />}
				{stored ? (
					<a href={opening.href} target="_blank" rel="noopener noreferrer" onClick={open} className={twMerge("relative block overflow-hidden rounded-[3px] bg-[#f4f1ea] outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97] @[560px]:rounded-[5px] dark:bg-white/[0.08]", SHADOW, SHADOW_LIFTED, PRESS)} style={{ aspectRatio: ratio }}>
						<CoverPage src={stored} alt={t("pdfPreviewAlt", { filename: front.filename || front.title || t("document") })} />
						<span aria-hidden className={EDGE} />
					</a>
				) : (
					<OnlinePdf url={front.url ?? ""} onOpen={open} className="rounded-[3px] bg-white @[560px]:rounded-[5px] dark:bg-[#1c1c1c]" />
				)}
			</div>
			{stacked && <span className="text-xs font-medium tabular-nums text-black/50 dark:text-white/50">{t("pdfCount", { count: pdfs.length })}</span>}
		</div>
	);
}

/** The page fades in over paper of its own size once it has loaded, so nothing moves. */
function CoverPage({ src, alt }: { src: string; alt: string }) {
	const [loaded, setLoaded] = useState(false);
	return (
		<CoverImage
			ref={(element) => {
				// A page the browser already holds is complete as soon as it is attached: show it on the first paint.
				if (element?.complete && element.naturalWidth > 0) setLoaded(true);
			}}
			src={src}
			alt={alt}
			fill
			sizes="(min-width: 768px) 192px, 96px"
			onLoad={() => setLoaded(true)}
			className={twMerge("object-cover object-top transition-opacity duration-300 motion-reduce:transition-none dark:brightness-[0.94]", loaded ? "opacity-100" : "opacity-0")}
		/>
	);
}

/** The sheets of the record's other PDFs, peeking out under the first, as iOS stacks a group. */
function StackSheets({ more }: { more: number }) {
	const sheets = Math.min(more, 2);
	return (
		<>
			{sheets > 1 && <span aria-hidden className={twMerge("absolute inset-x-[14%] -bottom-[9px] -z-20 h-1/2 rounded-[3px] bg-[#e9e5dc] @[560px]:rounded-[5px] dark:bg-[#2e2e2e]", SHADOW)}>
				<span className={EDGE} />
			</span>}
			<span aria-hidden className={twMerge("absolute inset-x-[7%] -bottom-[5px] -z-10 h-1/2 rounded-[3px] bg-[#efebe3] @[560px]:rounded-[5px] dark:bg-[#3d3d3d]", SHADOW)}>
				<span className={EDGE} />
			</span>
		</>
	);
}
