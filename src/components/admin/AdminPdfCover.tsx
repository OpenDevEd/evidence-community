"use client";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import {
	Add01Icon,
	AlertCircleIcon,
	FileAttachmentIcon,
	LinkSquare01Icon,
	Exchange01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Spinner } from "@/components/nextui/Spinner";
import type { AdminItemDetail } from "@/lib/admin/types";
import { documentAttachment, isUnrestoredRecord, type PdfUploadStep } from "./admin-pdf";
import { PdfFileInput } from "./PdfFileInput";

type CoverProps = {
	detail: AdminItemDetail;
	disabled: boolean;
	submitted: boolean;
	reviewId?: string;
	progress?: PdfUploadStep;
	error?: string;
	onUpload: (file: File) => void;
};

function coverPresentation(
	hasPdf: boolean,
	submitted: boolean,
	error?: string,
) {
	if (submitted)
		return {
			label: "Open submitted PDF",
			footer: "Open",
			icon: LinkSquare01Icon,
		};
	if (error)
		return {
			label: "Retry PDF",
			footer: "Retry PDF",
			icon: AlertCircleIcon,
		};
	if (hasPdf)
		return {
			label: "Replace PDF",
			footer: "Replace",
			icon: Exchange01Icon,
		};
	return { label: "Add PDF", footer: "Add PDF", icon: Add01Icon };
}

/** The staged draft's object when there is one, otherwise the published copy. */
function pdfObjectSource(
	file: ReturnType<typeof documentAttachment>,
	object: "cover" | "pdf",
	reviewId?: string,
) {
	const draft = file?.fileDraft;
	if (file && draft?.readyAt) {
		const query = new URLSearchParams({
			revision: String(draft.uploadRevision),
		});
		if (reviewId) query.set("review", reviewId);
		return `/api/admin/items/${file.key}/file/${object}?${query}`;
	}
	return object === "cover"
		? file?.filePublication?.coverPublicUrl
		: file?.filePublication?.publicUrl;
}

function PdfCoverImage({
	url,
	filename,
	fallback,
}: {
	url: string;
	filename: string;
	fallback: ReactNode;
}) {
	const [state, setState] = useState<"loading" | "loaded" | "failed">(
		"loading",
	);
	if (state === "failed") return fallback;
	return (
		<>
			{state === "loading" && (
				<Spinner size="sm" aria-label="Loading PDF cover" />
			)}
			<Image
				unoptimized
				width={80}
				height={112}
				src={url}
				alt={filename}
				className={`absolute inset-0 h-full w-full object-cover object-top pb-6 transition-opacity motion-reduce:transition-none ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
				onLoad={() => setState("loaded")}
				onError={() => setState("failed")}
			/>
		</>
	);
}

function PdfCoverContent({
	url,
	filename,
	hasPdf,
	error,
	progress,
}: {
	url?: string | null;
	filename: string;
	hasPdf: boolean;
	error?: string;
	progress?: PdfUploadStep;
}) {
	if (progress)
		return (
			<>
				<Spinner size="sm" aria-label={progress} />
				<span className="text-[10px] font-medium" role="status">
					{progress}
				</span>
			</>
		);
	const caption = error ? "Upload failed" : hasPdf ? "PDF added" : "";
	const fallback = (
		<>
			<HugeiconsIcon
				icon={error ? AlertCircleIcon : FileAttachmentIcon}
				size={29}
				className={hasPdf ? "text-accent-300 dark:text-accent-700" : ""}
			/>
			{caption && <span className="text-[10px] font-medium">{caption}</span>}
		</>
	);
	if (error || !url) return fallback;
	return (
		<PdfCoverImage
			key={url}
			url={url}
			filename={filename}
			fallback={fallback}
		/>
	);
}

type DocumentFile = ReturnType<typeof documentAttachment>;

function attachmentHasPdf(file: DocumentFile) {
	return Boolean(file?.fileDraft?.readyAt || file?.filePublication || file?.sourceFileUrl);
}

function coverFilename(file: DocumentFile) {
	return file?.fileDraft?.filename ?? file?.filePublication?.filename ?? "PDF cover";
}

function coverModel(detail: AdminItemDetail, submitted: boolean, reviewId?: string, error?: string) {
	const file = documentAttachment(detail);
	const hasPdf = attachmentHasPdf(file);
	return {
		hasPdf,
		url: pdfObjectSource(file, "cover", submitted ? reviewId : undefined),
		pdfUrl: submitted ? pdfObjectSource(file, "pdf", reviewId) : undefined,
		filename: coverFilename(file),
		presentation: coverPresentation(hasPdf && file?.sourceConnectionKey === "native", submitted, error),
	};
}

const SURFACE = "group relative flex h-28 w-20 shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-black/10 bg-white text-black/35 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-white/35";

/** The cover surface as a link (submitted), a button (editable) or a plain image (nothing to do). */
function CoverFrame({ href, onOpen, blocked = false, label, children }: { href?: string; onOpen?: () => void; blocked?: boolean; label: string; children: ReactNode }) {
	if (href)
		return (
			<a href={href} target="_blank" rel="noreferrer" aria-label={label} className={`${SURFACE} transition-colors hover:border-accent/50 focus-visible:outline-focus`}>
				{children}
			</a>
		);
	if (onOpen)
		return (
			<button type="button" aria-label={label} disabled={blocked} onClick={onOpen} className={`${SURFACE} transition-colors enabled:hover:border-accent/50 focus-visible:outline-focus disabled:cursor-default disabled:opacity-50 dark:enabled:hover:border-accent/50`}>
				{children}
			</button>
		);
	return (
		<div className={SURFACE} role="img" aria-label={label}>
			{children}
		</div>
	);
}

export function AdminPdfCover({
	detail,
	disabled,
	submitted,
	reviewId,
	progress,
	error,
	onUpload,
}: CoverProps) {
	const { hasPdf, url, pdfUrl, filename, presentation } = coverModel(detail, submitted, reviewId, error);
	const cover = <PdfCoverContent url={url} filename={filename} hasPdf={hasPdf} error={error} progress={progress} />;
	const footer = (
		<span className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-center gap-1 bg-black/[0.03] text-[10px] font-medium text-black/60 dark:bg-white/[0.04] dark:text-white/60">
			<HugeiconsIcon icon={presentation.icon} size={12} />
			{progress ? "Please wait" : presentation.footer}
		</span>
	);
	// A Zotero PDF is Zotero's file: the cover shows it, and nothing is added from here.
	if (isUnrestoredRecord(detail) || detail.sourcePdf || (submitted && !pdfUrl))
		return <CoverFrame label={hasPdf ? "PDF cover" : "No PDF"}>{cover}</CoverFrame>;
	if (submitted)
		return <CoverFrame href={pdfUrl} label={presentation.label}>{cover}{footer}</CoverFrame>;
	const blocked = disabled || Boolean(progress);
	return (
		<PdfFileInput attachmentKey={detail.key} disabled={blocked} onUpload={(_, picked) => onUpload(picked)}>
			{(open) => <CoverFrame onOpen={open} blocked={blocked} label={presentation.label}>{cover}{footer}</CoverFrame>}
		</PdfFileInput>
	);
}
