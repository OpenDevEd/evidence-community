/**
 * Abstracts are stored with Zotero's rich-text markup and HTML entities.
 * This turns one into a single clean paragraph for previews, search results,
 * and anything sent to a model.
 */
export function abstractPlainText(value: unknown): string {
	if (typeof value !== "string" || !value) return "";

	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim();
}
