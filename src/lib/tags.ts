type TagsInput = readonly string[] | null | undefined;

export function hasTag(tags: TagsInput, tag: string): boolean {
	const expected = tag.toLowerCase();
	return tags?.some((value) => value.toLowerCase() === expected) ?? false;
}

export function hasAnyTag(tags: TagsInput, expectedTags: readonly string[]): boolean {
	const normalizedTags = new Set(tags?.map((value) => value.toLowerCase()) ?? []);
	return expectedTags.some((tag) => normalizedTags.has(tag.toLowerCase()));
}


type PublicAttachmentTags = { hidden: readonly string[]; publish: readonly string[] };

/**
 * Remove non-public attachments before a record reaches readers or exports.
 * A note is public only when it carries a publish tag; the rest are private
 * working notes, so they never leave the server.
 */
export function filterPublicAttachments<T extends { deleted?: number | null; itemType?: string | null; note?: string | null; tags?: readonly string[] | null }>(attachments: readonly T[] | undefined, tags: PublicAttachmentTags) {
	return attachments
		?.filter(attachment =>
			attachment.deleted === 0 &&
			!hasAnyTag(attachment.tags, tags.hidden) &&
			(attachment.itemType !== "Note" || hasAnyTag(attachment.tags, tags.publish)),
		)
		// Only published notes show their text; a note kept on a file is never shown.
		.map(attachment => attachment.itemType === "Note" || attachment.note == null ? attachment : { ...attachment, note: null });
}
