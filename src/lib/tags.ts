type TagsInput = readonly string[] | null | undefined;

export function hasTag(tags: TagsInput, tag: string): boolean {
	const expected = tag.toLowerCase();
	return tags?.some((value) => value.toLowerCase() === expected) ?? false;
}

export function hasAnyTag(tags: TagsInput, expectedTags: readonly string[]): boolean {
	const normalizedTags = new Set(tags?.map((value) => value.toLowerCase()) ?? []);
	return expectedTags.some((tag) => normalizedTags.has(tag.toLowerCase()));
}


/** The publish tags of each source's records, by source key. */
export type SourcePublishTags = Readonly<Record<string, readonly string[]>>;

type PublishTagConfig = { content: { tags: { publish: readonly string[] } }; sources: readonly { key: string; provider: string; settings: object }[] };

/** The library's publish tags for the records it made itself, and each Zotero source's own. */
export function sourcePublishTags(config: PublishTagConfig): Record<string, string[]> {
	return Object.fromEntries([
		["native", [...config.content.tags.publish]],
		...config.sources.flatMap((source) => {
			const rule = source.provider === "zotero" ? (source.settings as { pdfPublishing?: { tags: readonly string[] } }).pdfPublishing : undefined;
			return rule ? [[source.key, [...rule.tags]]] : [];
		}),
	]);
}

/** The tags that make a record's notes and links public: its source's publish tags; none for any other source. */
export function recordPublishTags(bySource: SourcePublishTags, sourceConnectionKey: string | null | undefined): readonly string[] {
	return sourceConnectionKey && Object.hasOwn(bySource, sourceConnectionKey) ? bySource[sourceConnectionKey]! : [];
}

/** What decides which records and attachments readers see: the hidden tags, and each source's publish tags. */
export type PublicTagRules = { hidden: readonly string[]; publishBySource: SourcePublishTags };

export function publicTagRules(config: PublishTagConfig & { content: { tags: { hidden: readonly string[] } } }): PublicTagRules {
	return { hidden: config.content.tags.hidden, publishBySource: sourcePublishTags(config) };
}
