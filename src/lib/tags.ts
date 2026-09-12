type TagsInput = readonly string[] | null | undefined;

export function hasTag(tags: TagsInput, tag: string): boolean {
	const expected = tag.toLowerCase();
	return tags?.some((value) => value.toLowerCase() === expected) ?? false;
}

export function hasAnyTag(tags: TagsInput, expectedTags: readonly string[]): boolean {
	const normalizedTags = new Set(tags?.map((value) => value.toLowerCase()) ?? []);
	return expectedTags.some((tag) => normalizedTags.has(tag.toLowerCase()));
}


/** Remove non-public attachments before search results reach readers or exports. */
export function filterPublicAttachments<T extends { deleted?: number | null; tags?: readonly string[] | null }>(attachments: readonly T[] | undefined, hiddenTags: readonly string[]) {
	return attachments?.filter(attachment => attachment.deleted === 0 && !hasAnyTag(attachment.tags, hiddenTags));
}
