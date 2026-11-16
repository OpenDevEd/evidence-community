import {
	isReasoningUIPart,
	isTextUIPart,
	isToolUIPart,
	type UIMessage,
} from "ai";
import { LABELLED_PAGE_MARKER, parsePageCitation } from "./citations";
import {
	isScreeningResultsData,
	screeningExportContent,
} from "./screening-export";
import { toolActivitySummary } from "./tool-activity";

export type ChatTranscriptFormat = "plaintext" | "markdown" | "html";

export type ChatTranscriptLabels = {
	title: string;
	user: string;
	assistant: string;
	reasoning: string;
	smartScreening: string;
};

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function absoluteUrl(href: string, origin?: string) {
	if (!origin || !href.startsWith("/")) return href;
	return new URL(href, origin).toString();
}

function normalizeEvidenceMarkdown(content: string, origin?: string) {
	let normalized = content.replace(
		/\[QUOTE\s*([\s\S]*?)\s*QUOTE\/\][\s.,]*/g,
		"\n> $1\n",
	);
	normalized = normalized.replace(
		new RegExp(String.raw`\[(?:PAGE\s*|${LABELLED_PAGE_MARKER})(.*?)\s*PAGE\/\]`, "g"),
		(_match, citationTarget: string) => {
			const citation = parsePageCitation(citationTarget);
			return citation.href
				? `[Source, p. ${citation.page}](${absoluteUrl(citation.href, origin)})`
				: `(Source unavailable, p. ${citation.page})`;
		},
	);
	normalized = normalized.replace(
		/\[RESOURCE\s+(\/lib\/([^/?#\s]+))\s+RESOURCE\/\]/g,
		(_match, href: string, itemKey: string) =>
			`[Publication ${itemKey}](${absoluteUrl(href, origin)})`,
	);
	normalized = normalized.replace(
		/\[SECTION\s*(.*?)\s*SECTION\/\]/g,
		"(section $1)",
	);

	if (origin) {
		normalized = normalized.replace(
			/]\((\/lib\/[^)]+)\)/g,
			(_match, href: string) => `](${absoluteUrl(href, origin)})`,
		);
	}

	return normalized.trim();
}

function markdownToPlainText(markdown: string) {
	return markdown
		.replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
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

function safeLinkHref(href: string, origin?: string) {
	try {
		if (href.startsWith("/")) return absoluteUrl(href, origin);
		const parsed = new URL(href);
		return ["http:", "https:", "mailto:"].includes(parsed.protocol)
			? href
			: undefined;
	} catch {
		return undefined;
	}
}

async function createSafeMarkdownRenderer(origin?: string) {
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

function parseScreeningMessage(message: UIMessage) {
	if (!message.id.startsWith("screening-result")) return undefined;
	let content = "";
	for (const part of message.parts) {
		if (isTextUIPart(part)) content += part.text;
	}

	try {
		const parsed: unknown = JSON.parse(content);
		return isScreeningResultsData(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function toolItemMarkdown(toolName: string, item: string, origin?: string) {
	return toolName === "readPublications"
		? `[${item}](${absoluteUrl(`/lib/${item}`, origin)})`
		: item;
}

function toolItemPlaintext(toolName: string, item: string, origin?: string) {
	return toolName === "readPublications"
		? `${item} (${absoluteUrl(`/lib/${item}`, origin)})`
		: item;
}

function markdownToolActivity(
	part: Parameters<typeof toolActivitySummary>[0],
	origin?: string,
) {
	const summary = toolActivitySummary(part);
	return [
		`### Tool: ${summary.title}`,
		summary.items.length
			? summary.items
					.map(
						(item) =>
							`- ${toolItemMarkdown(summary.toolName, item, origin)}`,
					)
					.join("\n")
			: undefined,
		summary.detail,
		summary.error ? `Error: ${summary.error}` : undefined,
	]
		.filter((value): value is string => !!value)
		.join("\n\n");
}

function plaintextToolActivity(
	part: Parameters<typeof toolActivitySummary>[0],
	origin?: string,
) {
	const summary = toolActivitySummary(part);
	return [
		`Tool: ${summary.title}`,
		...summary.items.map(
			(item) => `- ${toolItemPlaintext(summary.toolName, item, origin)}`,
		),
		summary.detail,
		summary.error ? `Error: ${summary.error}` : undefined,
	]
		.filter((value): value is string => !!value)
		.join("\n");
}

function htmlToolActivity(
	part: Parameters<typeof toolActivitySummary>[0],
	origin?: string,
) {
	const summary = toolActivitySummary(part);
	const items = summary.items.map((item) => {
		if (summary.toolName !== "readPublications") {
			return `<li>${escapeHtml(item)}</li>`;
		}
		const href = absoluteUrl(`/lib/${item}`, origin);
		return `<li><a href="${escapeHtml(href)}">${escapeHtml(item)}</a></li>`;
	});
	return [
		'<section class="tool-activity">',
		`<h3>Tool: ${escapeHtml(summary.title)}</h3>`,
		items.length ? `<ul>${items.join("")}</ul>` : "",
		summary.detail ? `<p>${escapeHtml(summary.detail)}</p>` : "",
		summary.error
			? `<p><strong>Error:</strong> ${escapeHtml(summary.error)}</p>`
			: "",
		"</section>",
	].join("\n");
}

export async function chatTranscriptContent(
	format: ChatTranscriptFormat,
	messages: UIMessage[],
	labels: ChatTranscriptLabels,
	origin?: string,
) {
	const output: string[] = [];
	const markdownToHtml =
		format === "html"
			? await createSafeMarkdownRenderer(origin)
			: undefined;

	if (format === "markdown") output.push(`# ${labels.title}`);
	if (format === "plaintext") output.push(labels.title);
	if (format === "html") {
		output.push("<article>", `<h1>${escapeHtml(labels.title)}</h1>`);
	}

	for (const message of messages) {
		const screening = parseScreeningMessage(message);
		if (screening) {
			const generated = screeningExportContent(screening, origin);
			if (format === "markdown") {
				output.push(
					`## ${labels.smartScreening}`,
					generated.markdown.replace(
						/^# Smart Screening Results\n+/,
						"",
					),
				);
			}
			if (format === "plaintext") {
				output.push(
					labels.smartScreening,
					generated.plaintext.replace(
						/^Smart Screening Results\n+/,
						"",
					),
				);
			}
			if (format === "html") {
				output.push(
					'<section class="message screening-results">',
					`<h2>${escapeHtml(labels.smartScreening)}</h2>`,
					generated.html.replace(
						"<h1>Smart Screening Results</h1>\n",
						"",
					),
					"</section>",
				);
			}
			continue;
		}

		const roleLabel =
			message.role === "user" ? labels.user : labels.assistant;
		if (format === "markdown") output.push(`## ${roleLabel}`);
		if (format === "plaintext") output.push(roleLabel);
		if (format === "html") {
			output.push(
				`<section class="message ${message.role}">`,
				`<h2>${escapeHtml(roleLabel)}</h2>`,
			);
		}

		for (const part of message.parts) {
			if (isTextUIPart(part) && part.text.trim()) {
				const markdown = normalizeEvidenceMarkdown(part.text, origin);
				if (format === "markdown") output.push(markdown);
				if (format === "plaintext") {
					output.push(markdownToPlainText(markdown));
				}
				if (format === "html" && markdownToHtml) {
					output.push(markdownToHtml(markdown));
				}
			}

			if (isReasoningUIPart(part) && part.text.trim()) {
				const markdown = normalizeEvidenceMarkdown(part.text, origin);
				if (format === "markdown") {
					output.push(`### ${labels.reasoning}`, markdown);
				}
				if (format === "plaintext") {
					output.push(
						labels.reasoning,
						markdownToPlainText(markdown),
					);
				}
				if (format === "html" && markdownToHtml) {
					output.push(
						'<section class="reasoning">',
						`<h3>${escapeHtml(labels.reasoning)}</h3>`,
						markdownToHtml(markdown),
						"</section>",
					);
				}
			}

			if (isToolUIPart(part)) {
				if (format === "markdown")
					output.push(markdownToolActivity(part, origin));
				if (format === "plaintext") {
					output.push(plaintextToolActivity(part, origin));
				}
				if (format === "html")
					output.push(htmlToolActivity(part, origin));
			}
		}

		if (format === "html") output.push("</section>");
	}

	if (format === "html") output.push("</article>");
	return output.filter(Boolean).join(format === "html" ? "\n" : "\n\n");
}

export const CHAT_EXPORT_OUTPUT: Record<
	ChatTranscriptFormat,
	{ extension: string; mimeType: string }
> = {
	plaintext: { extension: "txt", mimeType: "text/plain;charset=utf-8" },
	markdown: { extension: "md", mimeType: "text/markdown;charset=utf-8" },
	html: { extension: "html", mimeType: "text/html;charset=utf-8" },
};

/**
 * Export only the final answer of a single message: its text parts, with
 * evidence tokens normalized. Reasoning, tool activity, and role labels are
 * intentionally excluded.
 */
export async function chatMessageContent(
	format: ChatTranscriptFormat,
	message: UIMessage,
	origin?: string,
) {
	const markdown = message.parts
		.filter(isTextUIPart)
		.map((part) => normalizeEvidenceMarkdown(part.text, origin))
		.filter(Boolean)
		.join("\n\n");

	if (format === "markdown") return markdown;
	if (format === "plaintext") return markdownToPlainText(markdown);
	const markdownToHtml = await createSafeMarkdownRenderer(origin);
	return markdownToHtml(markdown);
}
