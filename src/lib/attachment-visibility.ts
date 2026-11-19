import type { ListAttachment } from "@/app/api/item/types";
import { isIdentifierAttachment } from "@/lib/publication/publication-display-adapter";
import { hasAnyTag, recordPublishTags, type PublicTagRules } from "@/lib/tags";
import { fileAccessOf, fileAccessSchema, filesHiddenOn, licenceOpen, recordLicenceSchema, utcDay } from "@/lib/licences";

type AttachmentVisibilityFields = {
	PDFCoverPageImage?: string | null;
	contentType?: string | null;
	linkMode?: string | null;
	url?: string | null;
};

type ItemPageAttachmentFields = AttachmentVisibilityFields & {
	itemType?: string | null;
	note?: string | null;
	tags?: string[] | null;
};

/** A stored PDF has a cover. A PDF link has a URL only once its source publishes it. */
export function isVisiblePdfAttachment(
	attachment: AttachmentVisibilityFields,
) {
	return Boolean(
		attachment.PDFCoverPageImage ||
			(attachment.linkMode === "linked_url" &&
				attachment.contentType?.toLowerCase() === "application/pdf" &&
				/^https?:\/\//u.test(attachment.url ?? "")),
	);
}

export function isPublishedNote(
	attachment: ItemPageAttachmentFields,
	publishTags: readonly string[],
) {
	return (
		attachment.itemType === "Note" &&
		Boolean(attachment.note) &&
		hasAnyTag(attachment.tags, publishTags)
	);
}

export function isPublishedLink(
	attachment: ItemPageAttachmentFields,
	publishTags: readonly string[],
) {
	return (
		attachment.linkMode === "linked_url" &&
		Boolean(attachment.url) &&
		hasAnyTag(attachment.tags, publishTags)
	);
}

/**
 * The attachments the public item page reads, with only the fields it reads.
 * List results carry these so the page drawn from a result card matches the
 * full record.
 */
export function itemPageAttachments(
	attachments: readonly ListAttachment[] | undefined,
	publishTags: readonly string[],
): ListAttachment[] | undefined {
	return attachments
		?.filter(
			(attachment) =>
				isVisiblePdfAttachment(attachment) ||
				isPublishedNote(attachment, publishTags) ||
				isPublishedLink(attachment, publishTags) ||
				isIdentifierAttachment(attachment),
		)
		.map((attachment) => ({
			key: attachment.key,
			parentItem: attachment.parentItem,
			itemType: attachment.itemType,
			linkMode: attachment.linkMode,
			title: attachment.title,
			filename: attachment.filename,
			url: attachment.url,
			contentType: attachment.contentType,
			tags: attachment.tags,
			PDFCoverPageImage: attachment.PDFCoverPageImage,
			PDFCoverPageWidth: attachment.PDFCoverPageWidth,
			PDFCoverPageHeight: attachment.PDFCoverPageHeight,
			note: isPublishedNote(attachment, publishTags) ? attachment.note : null,
		}));
}

export function hasVisiblePdfAttachment(
	item:
		| { attachmentsData?: AttachmentVisibilityFields[] | null }
		| null
		| undefined,
) {
	return Boolean(item?.attachmentsData?.some(isVisiblePdfAttachment));
}

/**
 * Whether a record's own files are kept from readers on `today`: its licence and who may get its files say private, or
 * an embargo whose day hasn't come. Read when a record is read, so an embargo ends on its day with nothing else done.
 */
export function filesHiddenFor(record: { licence?: unknown; fileAccess?: unknown } | null | undefined, today = utcDay()) {
	const licence = recordLicenceSchema.safeParse(record?.licence).data;
	const chosen = fileAccessSchema.safeParse(record?.fileAccess).data;
	return filesHiddenOn(fileAccessOf(licence, chosen), today);
}

/**
 * Whether a record made here is open access: under a licence that lets anyone share it, with files readers can get on
 * `today`. Null for a record with no licence of its own, whose open access is looked up as before.
 */
export function ownOpenAccess(record: { licence?: unknown; fileAccess?: unknown }, today = utcDay()) {
	const licence = recordLicenceSchema.safeParse(record.licence).data;
	if (!licence) return null;
	return licenceOpen(licence) && !filesHiddenFor(record, today);
}

/** A file the community stores for a record, as opposed to a link to one elsewhere: what a record's file access governs. */
const storedFile = (attachment: { itemType?: string | null; linkMode?: string | null }) => attachment.itemType?.toLowerCase() === "attachment" && attachment.linkMode !== "linked_url";

/** Whether readers may see this attachment as far as its record's file access goes: all but its stored files when hidden. */
export const shownFile = (attachment: { itemType?: string | null; linkMode?: string | null }, filesHidden: boolean) => !filesHidden || !storedFile(attachment);

/**
 * Remove non-public attachments before a record reaches readers or exports. A note or an ordinary link is public only
 * when it carries one of its record's publish tags; the rest are private working notes and links, so they never leave
 * the server. Published PDFs and identifier links always stay.
 */
export function filterPublicAttachments<T extends { deleted?: number | null; itemType?: string | null; note?: string | null; tags?: readonly string[] | null } & AttachmentVisibilityFields>(
	/** The record, whose licence and file access decide whether readers get its files (`filesHiddenFor`). */
	record: { attachmentsData?: readonly T[] | null; sourceConnectionKey?: string | null; licence?: unknown; fileAccess?: unknown },
	rules: PublicTagRules,
) {
	const publish = recordPublishTags(rules.publishBySource, record.sourceConnectionKey);
	const filesHidden = filesHiddenFor(record);
	return record.attachmentsData
		?.filter(attachment =>
			attachment.deleted === 0 &&
			shownFile(attachment, filesHidden) &&
			!hasAnyTag(attachment.tags, rules.hidden) &&
			(attachment.itemType !== "Note" || hasAnyTag(attachment.tags, publish)) &&
			(attachment.linkMode !== "linked_url" || isVisiblePdfAttachment(attachment) || isIdentifierAttachment(attachment) || hasAnyTag(attachment.tags, publish)),
		)
		// Only published notes show their text; a note kept on a file is never shown.
		.map(attachment => attachment.itemType === "Note" || attachment.note == null ? attachment : { ...attachment, note: null });
}
