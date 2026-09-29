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

/**
 * Where the cited pages live for a whole conversation.
 *
 * The publications come in the order the chat shows them, newest first. Two
 * publications can have a PDF with the same name, so the older ones are put in
 * first and the newest one wins.
 */
export function bucketPdfCitationSources(
	keysNewestFirst: string[],
	attachmentsByKey: Record<string, PdfAttachment[] | null | undefined>,
) {
	const sources: Record<string, string> = {};
	for (let index = keysNewestFirst.length - 1; index >= 0; index -= 1) {
		const key = keysNewestFirst[index];
		Object.assign(
			sources,
			publicationPdfCitationSources(key, attachmentsByKey[key]),
		);
	}

	return sources;
}

function pageCitation(
	source: string,
	page: string,
	knownSources: Record<string, string>,
): PageCitation {
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

// Where one packed entry ends and the next begins: "PAGE/, PAGE " or "PAGE/, ".
const PACKED_ENTRY_SEPARATOR = /\s+PAGE\/\s*,?\s*(?:PAGE\s+)?/;

/**
 * The pages one PAGE token cites, one citation per page. Models sometimes
 * pack several pages into one token (`— 3 PAGE/, PAGE /lib/… — 4`,
 * `— 3 PAGE/, 4` or `— 3, 4`); an entry without its own file uses the file
 * named before it.
 */
export function parsePageCitations(
	value: string,
	knownSources: Record<string, string> = {},
): PageCitation[] {
	let source = "";
	return value
		.split(PACKED_ENTRY_SEPARATOR)
		.filter((entry) => entry.trim())
		.flatMap((entry) => {
			const separatorIndex = entry.lastIndexOf(" — ");
			if (separatorIndex >= 0) source = entry.slice(0, separatorIndex).trim();
			const page = (
				separatorIndex >= 0 ? entry.slice(separatorIndex + 3) : entry
			).trim();
			const pages = /^\d+(?:\s*,\s*\d+)+$/.test(page)
				? page.split(/\s*,\s*/)
				: [page];
			return pages.map((pageLabel) =>
				pageCitation(source, pageLabel, knownSources),
			);
		});
}
