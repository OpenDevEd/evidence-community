import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";

type PdfAttachment = {
	key: string;
	filename?: string | null;
	title?: string | null;
	PDFCoverPageImage?: string | null;
	tags?: string[] | null;
};

export type PageCitation = {
	page: string;
	href?: string;
};

export function buildPdfDownloadPath(itemKey: string, attachmentKey: string) {
	return `/lib/${itemKey}/download/${attachmentKey}`;
}

export function pdfFilename(
	attachment: Pick<PdfAttachment, "key" | "filename" | "title">,
) {
	const source =
		attachment.filename || attachment.title || `${attachment.key}.pdf`;
	const cleaned = source.replace(/[^\p{L}\p{N}._ -]/gu, "_").trim();
	return (cleaned || `${attachment.key}.pdf`).toLowerCase().endsWith(".pdf")
		? cleaned
		: `${cleaned}.pdf`;
}

export function publicationPdfCitationSources(
	itemKey: string | undefined,
	attachments: PdfAttachment[] | null | undefined,
) {
	if (!itemKey) return {};

	return Object.fromEntries(
		(attachments ?? [])
			.filter(isVisiblePdfAttachment)
			.map((attachment) => [
				pdfFilename(attachment),
				buildPdfDownloadPath(itemKey, attachment.key),
			]),
	);
}

export function parsePageCitation(
	value: string,
	knownSources: Record<string, string> = {},
): PageCitation {
	const separatorIndex = value.lastIndexOf(" — ");
	const source =
		separatorIndex >= 0 ? value.slice(0, separatorIndex).trim() : "";
	const page =
		separatorIndex >= 0 ? value.slice(separatorIndex + 3).trim() : value.trim();
	const target = source.startsWith("/lib/")
		? source
		: knownSources[source];
	const safeTarget = target?.match(/^\/lib\/[^/?#]+\/download\/[^/?#]+$/)
		? target
		: undefined;
	const pageNumber = page.match(/\d+/)?.[0];

	return {
		page,
		href: safeTarget
			? `${safeTarget}${pageNumber ? `#page=${pageNumber}` : ""}`
			: undefined,
	};
}
