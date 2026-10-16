type TagsInput = readonly string[] | null | undefined;

export function hasTag(tags: TagsInput, tag: string): boolean {
	const expected = tag.toLowerCase();
	return tags?.some((value) => value.toLowerCase() === expected) ?? false;
}

export function hasAnyTag(tags: TagsInput, expectedTags: readonly string[]): boolean {
	const normalizedTags = new Set(tags?.map((value) => value.toLowerCase()) ?? []);
	return expectedTags.some((tag) => normalizedTags.has(tag.toLowerCase()));
}


/** Each Zotero source's publish tags, by source key. */
export type SourcePublishTags = Readonly<Record<string, readonly string[]>>;

/** Each Zotero source's publish tags, from the library configuration. */
export function sourcePublishTags(sources: readonly { key: string; provider: string; settings: object }[]): Record<string, string[]> {
	return Object.fromEntries(
		sources.flatMap((source) => {
			const rule = source.provider === "zotero" ? (source.settings as { pdfPublishing?: { tags: readonly string[] } }).pdfPublishing : undefined;
			return rule ? [[source.key, [...rule.tags]]] : [];
		}),
	);
}

/**
 * The tags that make a record's notes and links public: its Zotero source's publish tags. Null for a record the
 * library made itself, whose notes and links are always public; a record from any other source has none.
 */
export function recordPublishTags(bySource: SourcePublishTags, sourceConnectionKey: string | null | undefined): readonly string[] | null {
	if (sourceConnectionKey === "native") return null;
	return (sourceConnectionKey && bySource[sourceConnectionKey]) || [];
}

/** Whether these tags publish a note or link; null publish tags publish every one. */
export function publishedByTags(tags: TagsInput, publishTags: readonly string[] | null) {
	return publishTags === null || hasAnyTag(tags, publishTags);
}

/** What decides which records and attachments readers see: the hidden tags, and each source's publish tags. */
export type PublicTagRules = { hidden: readonly string[]; publishBySource: SourcePublishTags };

export function publicTagRules(config: { content: { tags: { hidden: readonly string[] } }; sources: readonly { key: string; provider: string; settings: object }[] }): PublicTagRules {
	return { hidden: config.content.tags.hidden, publishBySource: sourcePublishTags(config.sources) };
}
