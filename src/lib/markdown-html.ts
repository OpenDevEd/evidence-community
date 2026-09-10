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

export async function createSafeMarkdownRenderer(origin?: string, styles?: {paragraph: string; heading: string; link: string}) {
	const { Marked, Renderer } = await import("marked");
	const renderer = new Renderer();
  if (styles) {
    renderer.paragraph = function ({tokens}) { return `<p style="${escapeHtml(styles.paragraph)}">${this.parser.parseInline(tokens)}</p>`; };
    renderer.heading = function ({tokens, depth}) { return `<h${depth} style="${escapeHtml(styles.heading)}">${this.parser.parseInline(tokens)}</h${depth}>`; };
  }

	renderer.html = ({ text }) => escapeHtml(text);
	renderer.image = ({ text }) => escapeHtml(text);
	renderer.link = function ({ href, title, tokens }) {
		const label = this.parser.parseInline(tokens);
		const safeHref = safeLinkHref(href, origin);
		if (!safeHref) return label;
		const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
		return `<a href="${escapeHtml(safeHref)}"${titleAttribute}${styles ? ` style="${escapeHtml(styles.link)}"` : ""}>${label}</a>`;
	};

	const marked = new Marked({ gfm: true, renderer });
	return (markdown: string) =>
		String(marked.parse(markdown, { async: false }));
}
