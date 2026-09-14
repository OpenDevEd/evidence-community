"use client";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import {
	Add01Icon,
	AlertCircleIcon,
	FileAttachmentIcon,
	SquareLock01Icon,
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
			label: "Submitted PDF",
			footer: "Submitted",
			icon: SquareLock01Icon,
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

function coverSource(
	file: ReturnType<typeof documentAttachment>,
	reviewId?: string,
) {
	const draft = file?.fileDraft;
	if (file && draft?.readyAt) {
		const query = new URLSearchParams({
			revision: String(draft.uploadRevision),
		});
		if (reviewId) query.set("review", reviewId);
		return `/api/admin/items/${file.key}/file/cover?${query}`;
	}
	return file?.filePublication?.coverPublicUrl;
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
	const caption = error ? "Upload failed" : hasPdf ? "PDF added" : "No PDF";
	const fallback = (
		<>
			<HugeiconsIcon
				icon={error ? AlertCircleIcon : FileAttachmentIcon}
				size={29}
				className={hasPdf ? "text-accent-300 dark:text-accent-700" : ""}
			/>
			<span className="text-[10px] font-medium">{caption}</span>
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

export function AdminPdfCover({
	detail,
	disabled,
	submitted,
	reviewId,
	progress,
	error,
	onUpload,
}: CoverProps) {
	const file = documentAttachment(detail);
	const hasPdf = Boolean(
		file?.fileDraft?.readyAt ||
		file?.filePublication ||
		file?.sourceFileUrl,
	);
	const url = coverSource(file, submitted ? reviewId : undefined);
	const filename =
		file?.fileDraft?.filename ??
		file?.filePublication?.filename ??
		"PDF cover";
	const presentation = coverPresentation(
		hasPdf && file?.sourceConnectionKey === "native",
		submitted,
		error,
	);
	const cover = (
		<PdfCoverContent
			url={url}
			filename={filename}
			hasPdf={hasPdf}
			error={error}
			progress={progress}
		/>
	);
	const surfaceClassName = "group relative flex h-28 w-20 shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-black/10 bg-white text-black/35 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-white/35";
	if (isUnrestoredRecord(detail)) {
		return (
			<div className={surfaceClassName} role="img" aria-label={hasPdf ? "PDF cover" : "No PDF"}>
				{cover}
			</div>
		);
	}
	const blocked = disabled || Boolean(progress);
	return (
		<PdfFileInput
			attachmentKey={detail.key}
			disabled={blocked}
			onUpload={(_, picked) => onUpload(picked)}
		>
			{(open) => (
				<button
					type="button"
					aria-label={presentation.label}
					disabled={blocked}
					onClick={open}
					className={`${surfaceClassName} transition-colors hover:border-accent/50 focus-visible:outline-focus dark:hover:border-accent/50`}
				>
					{cover}
					<span className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-center gap-1 bg-black/[0.03] text-[10px] font-medium text-black/60 dark:bg-white/[0.04] dark:text-white/60">
						<HugeiconsIcon
							icon={presentation.icon}
							size={12}
						/>
						{progress ? "Please wait" : presentation.footer}
					</span>
				</button>
			)}
		</PdfFileInput>
	);
}
