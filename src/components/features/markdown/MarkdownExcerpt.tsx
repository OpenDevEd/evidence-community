import { markdownToPlainText } from "@/lib/markdown-text";

/**
 * A summary's words for a clamped excerpt: no formatting, list markers or
 * line breaks. Plain text, so pages that show only excerpts, such as the home
 * page, do not load the Markdown renderer.
 */
export function MarkdownExcerpt({ children, className }: { children: string; className?: string }) {
	const text = markdownToPlainText(children, { links: "text" })
		.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
		.replace(/\s+/g, " ");
	return <p className={className}>{text}</p>;
}
