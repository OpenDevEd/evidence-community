/** A link's address, which may hold one level of balanced parentheses, and an optional quoted title. */
const DESTINATION = String.raw`((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?`;

/**
 * Markdown as plain text: the words without the syntax. A link keeps its
 * address in brackets, as a transcript needs, unless `links` is "text".
 */
export function markdownToPlainText(markdown: string, { links = "text-and-address" }: { links?: "text" | "text-and-address" } = {}) {
	return markdown
		.replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
		.replace(new RegExp(`!\\[([^\\]]*)\\]\\(${DESTINATION}\\)`, "g"), "$1")
		.replace(new RegExp(`\\[([^\\]]+)\\]\\(${DESTINATION}\\)`, "g"), links === "text" ? "$1" : "$1 ($2)")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^>\s?/gm, "")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
		.replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
		.replace(/~~([^~]+)~~/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.trim();
}

/** A summary's words on one line: no formatting, list markers or line breaks. What a clamped excerpt and a page's description show. */
export function markdownExcerptText(markdown: string) {
	return markdownToPlainText(markdown, { links: "text" })
		.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
		.replace(/\s+/g, " ")
		.trim();
}
