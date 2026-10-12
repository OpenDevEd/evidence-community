"use client";

import {
	Book02Icon,
	File01Icon,
	File02Icon,
	Mortarboard01Icon,
	News01Icon,
	Pdf01Icon,
	PresentationBarChart01Icon,
} from "@hugeicons/core-free-icons";
import Image from "next/image";
import { Suspense, use } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";

import { pdfThumbnail } from "./pdf-thumbnail";

const TYPE_ICONS: Record<string, typeof Pdf01Icon> = {
	book: Book02Icon,
	bookSection: Book02Icon,
	conferencePaper: PresentationBarChart01Icon,
	journalArticle: News01Icon,
	report: File01Icon,
	thesis: Mortarboard01Icon,
};

function Thumbnail({ file }: { file: File }) {
	const url = use(pdfThumbnail(file));
	if (!url) return null;
	return <Image alt="" className="animate-fade-in object-cover object-top [animation-duration:400ms]" fill sizes="180px" src={url} unoptimized />;
}

/**
 * A record's cover: the PDF's first page when there is a PDF, its type's icon
 * otherwise. While the AI reads the PDF a light passes down the page.
 */
export function ImportCover({
	className = "",
	file,
	itemType,
	reading = false,
	size = 18,
}: {
	className?: string;
	file: File | null;
	itemType?: string | null;
	reading?: boolean;
	size?: number;
}) {
	return (
		<span className={`relative block aspect-[3/4] shrink-0 overflow-hidden rounded-[4px] bg-white shadow-sm ring-1 ring-black/10 dark:bg-white/[0.06] dark:ring-white/10 ${className}`}>
			<span className="absolute inset-0 flex items-center justify-center text-black/20 dark:text-white/20">
				<HugeiconsIcon aria-hidden icon={file ? Pdf01Icon : (TYPE_ICONS[itemType ?? ""] ?? File02Icon)} size={size} />
			</span>
			{file ? (
				<Suspense fallback={null}>
					<Thumbnail file={file} />
				</Suspense>
			) : null}
			{reading ? (
				<span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
					<span className="absolute inset-x-0 top-0 h-2/5 animate-pdf-scan bg-gradient-to-b from-transparent via-accent/20 to-transparent" />
				</span>
			) : null}
		</span>
	);
}
