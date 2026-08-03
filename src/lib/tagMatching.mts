type TagsInput = readonly string[] | null | undefined;

export function hasTag(tags: TagsInput, tag: string): boolean {
	const expected = tag.toLowerCase();
	return tags?.some((value) => value.toLowerCase() === expected) ?? false;
}

export function hasAnyTag(tags: TagsInput, expectedTags: readonly string[]): boolean {
	const normalizedTags = new Set(tags?.map((value) => value.toLowerCase()) ?? []);
	return expectedTags.some((tag) => normalizedTags.has(tag.toLowerCase()));
}
