"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { Item, ListAttachment, ListItem } from "@/app/api/item/types";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { twMerge } from "@/lib/tw-merge";
import { CoverImage } from "./CoverImage";
import { OnlinePdf, TitlePage } from "./PdfCover";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Files02Icon } from "@hugeicons/core-free-icons";
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
 * How far each PDF behind the front one sits: this share of the front page's width to the right and of its height up, and a
 * little further when the card is under the pointer, as the pages of a fanned hand spread.
 */
const FAN = { x: 8, y: 5 };
// Tailwind reads classes as written, so FAN's numbers are spelled out here too.
const FANNED = `[transform:translate(calc(var(--depth)*8%),calc(var(--depth)*-5%))] group-hover/card:[transform:translate(calc(var(--depth)*11%),calc(var(--depth)*-7%))] transition-transform ${EASE}`;

/**
 * The record's PDF as its first page, at the card's trailing edge: what a reader gets before they open it. A record with
 * several PDFs fans the first pages of the next two out behind it, and the front page carries the count. A PDF the library
 * links to but never stored has no first page, so a title page stands in. A record without a PDF has no cover.
 */
export function ResourceCover({ pdfs, title, short, parentType }: { pdfs: ListAttachment[]; title: string | undefined; short: boolean; parentType: string | undefined }) {
	const t = useTranslations("ui");
	const track = useTrackAttachment(parentType);
	// A PDF the library holds goes in front of one it only links to.
	const front = pdfs.find((pdf) => pdf.PDFCoverPageImage) ?? pdfs[0];
	const stored = front.PDFCoverPageImage;
	const ratio = stored && front.PDFCoverPageWidth && front.PDFCoverPageHeight ? front.PDFCoverPageWidth / front.PDFCoverPageHeight : PORTRAIT;
	const behind = pdfs.filter((pdf) => pdf !== front).slice(0, 2);
	// The stack is wider than one page by its fan, so the front page keeps the size it has alone.
	const share = 1 / (1 + (behind.length * FAN.x) / 100);
	const page = { width: `${share * 100}%`, aspectRatio: stored ? ratio : PORTRAIT };
	// The cover opens its PDF in a new tab, as the item page's View and Open Document do; the rest of the card opens the record.
	const opening = pdfOpening(front);
	const open = () => track(opening.action, opening.source);
	return (
		<div className={twMerge("[grid-area:cover]", COVER_WIDTH[short ? "short" : "full"])}>
			{/* The front page sits lower by the fan's height, so the pages behind it start at the top of the column. */}
			<div className={twMerge("relative isolate", LIFT)} style={{ width: `calc(var(--cover) * ${widthShare(ratio) / share})`, paddingTop: `${(behind.length * FAN.y * share) / page.aspectRatio}%` } as CSSProperties}>
				{behind.map((pdf, index) => <BehindPage key={pdf.key} pdf={pdf} title={title} depth={index + 1} style={page} />)}
				{stored ? (
					<a href={opening.href} target="_blank" rel="noopener noreferrer" onClick={open} className={twMerge("relative block overflow-hidden rounded-[3px] bg-[#f4f1ea] outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97] @[560px]:rounded-[5px] dark:bg-white/[0.08]", SHADOW, SHADOW_LIFTED, PRESS)} style={page}>
						{/* Keyed by its image: a card the list reuses for another record starts the new page hidden and fades it in. */}
						<CoverPage key={stored} src={stored} alt={t("pdfPreviewAlt", { filename: front.filename || front.title || t("document") })} />
						<span aria-hidden className={EDGE} />
					</a>
				) : (
					<div style={page}>
						<OnlinePdf url={front.url ?? ""} title={title} onOpen={open} className={twMerge("rounded-[3px] active:scale-[0.97] @[560px]:rounded-[5px]", SHADOW, SHADOW_LIFTED, PRESS)} />
					</div>
				)}
				{behind.length > 0 && (
					// How many PDFs, on the front page's corner, as a photo marks a set.
					<span className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full bg-black/60 py-1 pl-1.5 pr-2 text-[10px] font-semibold leading-none tabular-nums text-white backdrop-blur-md">
						<HugeiconsIcon icon={Files02Icon} className="size-3 shrink-0" />
						<span aria-hidden>{pdfs.length}</span>
						<span className="sr-only">{t("pdfCount", { count: pdfs.length })}</span>
					</span>
				)}
			</div>
		</div>
	);
}

/** A page that arrives within this long of being drawn simply appears, as an image the browser already holds does. */
const QUICK_MS = 60;

/**
 * The page loads as any image does and is drawn as soon as the browser holds it. Only one still on its way when the card is
 * drawn waits hidden over paper of its own size, and if it then takes longer than a few frames it fades in, so a reader looking
 * at it never sees it pop.
 */
function CoverPage({ src, alt }: { src: string; alt: string }) {
	const [arrival, setArrival] = useState<"held" | "waiting" | "late">("held");
	const drawnAt = useRef(0);
	return (
		<CoverImage
			ref={(element) => {
				// Read once, when the page is attached and before it is painted.
				if (!element || drawnAt.current) return;
				drawnAt.current = performance.now();
				if (!element.complete || element.naturalWidth === 0) setArrival("waiting");
			}}
			src={src}
			alt={alt}
			fill
			loading="eager"
			sizes="(min-width: 768px) 192px, 96px"
			onLoad={() => setArrival((current) => (current === "waiting" && performance.now() - drawnAt.current > QUICK_MS ? "late" : "held"))}
			className={twMerge(
				"object-cover object-top dark:brightness-[0.94]",
				arrival === "waiting" && "opacity-0",
				arrival === "late" && "animate-[fade-in_300ms_ease-out] motion-reduce:animate-none",
			)}
		/>
	);
}

/** The first page of one of the record's other PDFs, fanned out behind the front one; the further back, the dimmer. */
function BehindPage({ pdf, title, depth, style }: { pdf: ListAttachment; title: string | undefined; depth: number; style: CSSProperties }) {
	return (
		<span aria-hidden className={twMerge("absolute bottom-0 left-0 overflow-hidden rounded-[3px] bg-[#f4f1ea] @[560px]:rounded-[5px] dark:bg-[#2a2a2a]", SHADOW, FANNED)} style={{ ...style, zIndex: -depth, "--depth": depth } as CSSProperties}>
			{pdf.PDFCoverPageImage ? <CoverPage key={pdf.PDFCoverPageImage} src={pdf.PDFCoverPageImage} alt="" /> : <TitlePage title={title} className="rounded-none" />}
			<span className="absolute inset-0 bg-black" style={{ opacity: depth * 0.06 }} />
			<span className={EDGE} />
		</span>
	);
}
