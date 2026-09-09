import { escapeHtml } from "./escape-html";

function safeLinkHref(href: string, origin?: string) {
	try {
		if (href.startsWith("/") && !href.startsWith("//")) return origin ? new URL(href, origin).toString() : href;
		const parsed = new URL(href);
		return ["http:", "https:", "mailto:"].includes(parsed.protocol)
			? href
			: undefined;
	} catch {
		return undefined;
	}
}

export async function createSafeMarkdownRenderer(origin?: string) {
	const { Marked, Renderer } = await import("marked");
	const renderer = new Renderer();

	renderer.html = ({ text }) => escapeHtml(text);
	renderer.image = ({ text }) => escapeHtml(text);
	renderer.link = function ({ href, title, tokens }) {
		const label = this.parser.parseInline(tokens);
		const safeHref = safeLinkHref(href, origin);
		if (!safeHref) return label;
		const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
		return `<a href="${escapeHtml(safeHref)}"${titleAttribute}>${label}</a>`;
	};

	const marked = new Marked({ gfm: true, renderer });
	return (markdown: string) =>
		String(marked.parse(markdown, { async: false }));
}
