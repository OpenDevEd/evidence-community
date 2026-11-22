"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Download01Icon, LinkSquare01Icon, LockKeyholeIcon, ViewIcon } from "@hugeicons/core-free-icons";
import { useRef, useState, useEffect, type ReactNode, type RefObject } from "react";
import type { Item, ListAttachment } from "@/app/api/item/types";
import { Link } from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";
import { OnlinePdf, PdfCover, TitlePage } from "./PdfCover";
import { Button } from "@/components/nextui/Button";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/nextui/Card";
import { trackAttachmentInteraction } from "@/lib/analytics";
import { useReaderSession } from "@/components/layout/navbar/ReaderSession";

function downloadLink(url: string, filename: string) {
	fetch(url)
		.then((response) => response.blob())
		.then((blob) => {
			const link = document.createElement("a");
			link.href = URL.createObjectURL(blob);
			link.download = filename;
			link.click();
		})
		.catch(console.error);
}

/** Heights that let the cover slide up on hover, measured again on resize and once the cover loads. */
function useCoverHeights(loaded: boolean) {
	const imageRef = useRef<HTMLImageElement>(null);
	const parentRef = useRef<HTMLLIElement>(null);
	const [imageHeight, setImageHeight] = useState<number | undefined>(
		undefined,
	);
	const [parentHeight, setParentHeight] = useState<number | undefined>(
		undefined,
	);

	// Update height measurements when window resizes
	useEffect(() => {
		const updateHeights = () => {
			setImageHeight(imageRef.current?.height);
			setParentHeight(parentRef.current?.clientHeight);
		};

		// Initial measurement
		updateHeights();

		// Add resize listener
		window.addEventListener("resize", updateHeights);

		// Clean up
		return () => window.removeEventListener("resize", updateHeights);
	}, [loaded]); // Re-run when image is loaded

	return { imageRef, parentRef, imageHeight, parentHeight };
}

/** Where a PDF opens: on the site that holds it when the library only links to it, otherwise the library's own copy. */
export function pdfOpening(pdf: Pick<ListAttachment, "key" | "parentItem" | "url" | "linkMode" | "PDFCoverPageImage">) {
	return !pdf.PDFCoverPageImage && pdf.linkMode === "linked_url"
		? ({ href: pdf.url ?? undefined, action: "open", source: "external" } as const)
		: ({ href: `/lib/${pdf.parentItem}/download/${pdf.key}`, action: "view", source: "internal" } as const);
}

/** Counts a reader opening, viewing or downloading one of a record's files. */
export function useTrackAttachment(parentType: string | null | undefined) {
	const { reader } = useReaderSession();
	const locale = useLocale();
	return (action: "view" | "download" | "open", source: "internal" | "external") =>
		trackAttachmentInteraction({ action, source, parentType, locale, isAuthenticated: Boolean(reader) });
}

function AttachmentCover({
	data,
	imageRef,
	imageHeight,
	parentHeight,
	canHover,
	onLoad,
	onOpen,
}: {
	data: Item;
	imageRef: RefObject<HTMLImageElement | null>;
	imageHeight: number | undefined;
	parentHeight: number | undefined;
	canHover: boolean;
	onLoad: () => void;
	onOpen: () => void;
}) {
	const t = useTranslations("ui");
	return (
		// The cover opens the PDF, as View does.
		<a
			href={pdfOpening(data).href}
			target="_blank"
			rel="noopener noreferrer"
			onClick={onOpen}
			data-height={imageHeight}
			style={
				{
					"--image-height": `${
						-(imageHeight ?? 0) +
						(parentHeight ?? 0) -
						4 * 4
					}px`,
				} as any
			}
			className={twMerge(
				"mx-auto block w-full max-w-[200px] rounded-xl outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent",
				"md:w-24 lg:w-48 md:max-w-none md:mx-0 md:bottom-0 md:top-4 md:absolute md:overflow-hidden md:transition-all",
				canHover && "md:hover:top-[var(--image-height)]",
			)}
		>
			<PdfCover
				ref={imageRef}
				src={data?.PDFCoverPageImage}
				alt={t("pdfPreviewAlt", {
					filename: data?.filename || t("document"),
				})}
				onLoad={onLoad}
			/>
		</a>
	);
}

function AttachmentDetails({ data, item }: { data: Item; item: Item }) {
	const t = useTranslations("ui");
	const trackAttachment = useTrackAttachment(item.itemType);

	const isExternal = !data.PDFCoverPageImage && data.linkMode === "linked_url";
	const pdfUrl = data.url ?? undefined;
	const downloadURL = `/lib/${data.parentItem}/download/${data.key}`;

	return (
		<>
			<h4 className="text-lg font-medium line-clamp-2 lg:line-clamp-none">
				<Link
					href={isExternal ? pdfUrl : downloadURL}
					target="_blank"
					className="dark:text-current text-current text-wrap-anywhere text-lg"
					onClick={() =>
						trackAttachment(
							isExternal ? "open" : "view",
							isExternal ? "external" : "internal",
						)
					}
				>
					{data.filename || data.title || t("document")}
				</Link>
			</h4>
			<div className="flex gap-2 flex-wrap md:flex-nowrap">
				{!isExternal ? (
					<>
						<Button
							size="sm"
							onPress={() => {
								trackAttachment("view", "internal");
								window.open(downloadURL, "_blank");
							}}
							startContent={<HugeiconsIcon icon={ViewIcon} className="size-5" />}
						>
							{t("viewAttachment")}
						</Button>
						<Button
							size="sm"
							color="accent"
							startContent={<HugeiconsIcon icon={Download01Icon} className="size-5" />}
							onPress={() => {
								trackAttachment("download", "internal");
								downloadLink(data.url || "", data.filename || "");
							}}
						>
							{t("downloadAttachment")}
						</Button>
					</>
				) : (
					<Button
						size="sm"
						color="accent"
						startContent={<HugeiconsIcon icon={LinkSquare01Icon} className="size-5" />}
						onPress={() => {
							trackAttachment("open", "external");
							window.open(pdfUrl, "_blank");
						}}
					>
						{t("openDocument")}
					</Button>
				)}
			</div>
		</>
	);
}

export default function Attachment({ data, item }: { data: Item; item: Item }) {
	// A PDF that opens on another site has no first page here; it gets the title page the result cards show for it.
	if (!data.PDFCoverPageImage && data.linkMode === "linked_url" && data.url) return <OnlineAttachment data={data} item={item} url={data.url} />;
	return <FileAttachment data={data} item={item} />;
}

function OnlineAttachment({ data, item, url }: { data: Item; item: Item; url: string }) {
	const trackAttachment = useTrackAttachment(item.itemType);
	return (
		<SideCard>
			<OnlinePdf url={url} title={item.title ?? undefined} onOpen={() => trackAttachment("open", "external")} className="w-16 shrink-0 rounded-md shadow-sm" />
			<div className="flex min-w-0 flex-col gap-2">
				<AttachmentDetails data={data} item={item} />
			</div>
		</SideCard>
	);
}

function FileAttachment({ data, item }: { data: Item; item: Item }) {
	const [loaded, setLoaded] = useState(false);
	const canHover = loaded || !data?.PDFCoverPageImage;
	const { imageRef, parentRef, imageHeight, parentHeight } =
		useCoverHeights(loaded);
	const hasImage = data.PDFCoverPageImage;
	const trackAttachment = useTrackAttachment(item.itemType);

	return (
		<Card
			// @ts-expect-error temporary
			ref={parentRef}
			className={twMerge(
				"flex flex-col gap-4 p-4 rounded-2xl w-full dark:bg-background",
				hasImage && "md:relative md:overflow-visible",
			)}
			key={data.key}
			color="card"
		>
			{hasImage && (
				<AttachmentCover
					data={data}
					imageRef={imageRef}
					imageHeight={imageHeight}
					parentHeight={parentHeight}
					canHover={canHover}
					onLoad={() => setLoaded(true)}
					onOpen={() => trackAttachment("view", "internal")}
				/>
			)}
			<div
				className={twMerge(
					"flex flex-col gap-2",
					hasImage
						? "md:h-full md:ltr:ml-28 md:rtl:mr-28 lg:ltr:ml-52 lg:rtl:mr-52"
						: "",
				)}
			>
				<AttachmentDetails data={data} item={item} />
			</div>
		</Card>
	);
}

/**
 * A PDF its record keeps from readers for now, shown where the file would be: a page with a lock, whether it opens
 * on a day or stays with the community's editors, and that the record and its DOI are public meanwhile.
 */
export function HeldPdf({ until }: { until: string | null }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const day = until ? format.dateTime(new Date(`${until}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" }) : null;
	return (
		<SideCard>
			<span className="@container/pdf relative block w-16 shrink-0 overflow-hidden rounded-md shadow-sm">
				<TitlePage className="rounded-none opacity-60 dark:brightness-[0.94]" />
				<span className="absolute inset-0 flex items-center justify-center">
					<span className="flex size-[max(22px,40cqw)] items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md">
						<HugeiconsIcon icon={LockKeyholeIcon} className="size-[55%]" />
					</span>
				</span>
			</span>
			<div className="flex min-w-0 flex-col gap-1">
				{/* Under the page (a card under 12rem, a phone at large text) the title is a size smaller: at 320px and 200% a month like "November" didn't fit its line and broke inside. */}
				<h4 className="text-base font-medium text-wrap-anywhere sm:text-lg @[12rem]/side:text-lg">{day ? t("pdfPrivateUntil", { date: day }) : t("pdfPrivate")}</h4>
				<p className="text-sm text-black/60 dark:text-white/60">{t(day ? "pdfOpensOnItsDay" : "pdfEditorsOnly")}</p>
			</div>
		</SideCard>
	);
}

/**
 * A card with a page beside its words: a PDF on another site, or one its record keeps from readers. Under 12rem (a
 * phone at 150% text or more; at normal text a phone's card is 16rem or wider) the words go under the page: beside it
 * they had a column of 30 to 100px at 200% text, and a word like "community's" ran out of the card. From `sm` up the
 * words stay beside the page at any text size: large-text layouts change on phones only.
 */
function SideCard({ children }: { children: ReactNode }) {
	return (
		<Card className="@container/side w-full rounded-2xl p-4 dark:bg-background" color="card">
			<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center @[12rem]/side:flex-row @[12rem]/side:items-center">{children}</div>
		</Card>
	);
}
