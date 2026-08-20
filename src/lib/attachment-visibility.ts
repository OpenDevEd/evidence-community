type AttachmentVisibilityFields = {
	PDFCoverPageImage?: string | null;
	tags?: string[] | null;
};

export function isVisiblePdfAttachment(
	attachment: AttachmentVisibilityFields,
) {
	return Boolean(
		attachment.PDFCoverPageImage ||
			attachment.tags?.some(
				(tag) => tag.toLowerCase() === "_auto-process",
			),
	);
}

export function hasVisiblePdfAttachment(item: {
	attachmentsData?: AttachmentVisibilityFields[] | null;
} | null | undefined) {
	return Boolean(item?.attachmentsData?.some(isVisiblePdfAttachment));
}

