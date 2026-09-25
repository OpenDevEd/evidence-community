import type { ListAttachment } from "@/app/api/item/types";
import { isIdentifierAttachment } from "@/lib/publication/publication-display-adapter";
import { hasAnyTag } from "@/lib/tags";

type AttachmentVisibilityFields = {
	PDFCoverPageImage?: string | null;
	url?: string | null;
	contentType?: string | null;
};

type ItemPageAttachmentFields = AttachmentVisibilityFields & {
	tags?: string[] | null;
	itemType?: string | null;
	linkMode?: string | null;
	note?: string | null;
	url?: string | null;
};

export function isVisiblePdfAttachment(
	attachment: AttachmentVisibilityFields,
) {
	return Boolean(
		attachment.PDFCoverPageImage ||
			(attachment.contentType === "application/pdf" && /^https?:\/\//u.test(attachment.url ?? "")),
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
