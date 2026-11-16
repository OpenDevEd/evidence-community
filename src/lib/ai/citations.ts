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
		for (const [name, target] of Object.entries(publicationPdfCitationSources(key, attachmentsByKey[key]))) {
			sources[name] = target;
			// Keyed by itself too: a name can only point at one PDF, and every one read must still be citable.
			sources[target] = target;
		}
	}

	return sources;
}

/** The one read PDF of the publication a source names by its key, `KEY`, `/lib/KEY` or `/lib/KEY/download/…`; none when it has several. */
function onlyPdfOf(source: string, read: string[]) {
	const key = source.match(/^(?:\/lib\/)?([A-Za-z0-9]+)(?:\/download\/[^/?#]+)?$/)?.[1];
	if (!key) return undefined;
	const pdfs = [...new Set(read.filter((target) => target.startsWith(`/lib/${key}/download/`)))];
	return pdfs.length === 1 ? pdfs[0] : undefined;
}

function pageCitation(
	source: string,
	page: string,
	knownSources: Record<string, string>,
): PageCitation {
	const read = Object.values(knownSources);
	const named = source.startsWith("/lib/") ? source : knownSources[source];
	// Only a PDF the conversation read can be opened: a model copies the prompt's example target or guesses an
	// attachment key, and those addresses lead nowhere. A model that names a read publication by its key, alone or
	// with an invented attachment, means that publication's PDF when it has only one.
	const target = named && read.includes(named) ? named : onlyPdfOf(source, read);
	const safeTarget =
		target && /^\/lib\/[^/?#]+\/download\/[^/?#]+$/.test(target)
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

/**
 * Stands in for a PAGE token's opening `PAGE` marker when a model drops it:
 * `[/lib/KEY/download/ATTACHMENT — 6 PAGE/]`. Only a bracket that opens on a
 * library PDF and a page and closes with `PAGE/]`, with no other bracket in
 * between and no link after it, counts, so an ordinary bracket or link never
 * turns into a citation.
 */
export const MISSING_PAGE_MARKER = String.raw`(?=\/lib\/[^/?#\s\[\]]+\/download\/[^/?#\s\[\]]+ — [^\[\]]*? PAGE\/\](?![(\[]))`;

/**
 * Stands in for a PAGE token's opening `PAGE` marker when a model puts a label
 * before it: `[Girl Power — PAGE /lib/KEY/download/ATTACHMENT — 22 PAGE/]`.
 * The label is dropped. It holds no bracket or line break, and the rest must
 * be a library PDF and a page closed by `PAGE/]` with no link after it, so an
 * ordinary bracket or link never turns into a citation.
 */
export const LABELLED_PAGE_MARKER = String.raw`[^\[\]\n]*?\sPAGE\s+(?=\/lib\/[^/?#\s\[\]]+\/download\/[^/?#\s\[\]]+ — [^\[\]]*? PAGE\/\](?![(\[]))`;

// Where one packed entry ends and the next begins: "PAGE/, PAGE " or "PAGE/, ".
const PACKED_ENTRY_SEPARATOR = /\s+PAGE\/\s*,?\s*(?:PAGE\s+)?/;

/**
 * The pages one PAGE token cites, one citation per page. Models sometimes
 * pack several pages into one token (`— 3 PAGE/, PAGE /lib/… — 4`,
 * `— 3 PAGE/, 4` or `— 3, 4`); an entry without its own file uses the file
 * named before it. `knownSources` are the PDFs the conversation read, by file
 * name; a citation links only to one of them.
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
