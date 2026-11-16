import { createSafeMarkdownRenderer } from "@/lib/markdown-html";
import {
	isReasoningUIPart,
	isTextUIPart,
	isToolUIPart,
	type UIMessage,
} from "ai";
import { LABELLED_PAGE_MARKER, MISSING_PAGE_MARKER, parsePageCitations } from "./citations";
import { escapeHtml } from "@/lib/escape-html";
import { markdownToPlainText } from "@/lib/markdown-text";
import {
	isScreeningResultsData,
	screeningExportContent,
	type ScreeningResultsData,
} from "./screening-export";
import {
	toolActivitySummary,
	type ResearchToolPart,
} from "./tool-activity";

export type ChatTranscriptFormat = "plaintext" | "markdown" | "html";

export type ChatTranscriptLabels = {
	title: string;
	user: string;
	assistant: string;
	reasoning: string;
	smartScreening: string;
};


/** Transcripts are written in English, whatever language the page is in. */
const TOOL_TITLES: Record<string, string> = {
	"title.readCurrent": "Read current results",
	"title.readingCurrent": "Reading current results",
	"title.searchedCurrent": "Searched current results",
	"title.searchingCurrent": "Searching current results",
	"title.search": "Community search",
	"title.readingPublications": "Reading publications",
};

function absoluteUrl(href: string, origin?: string) {
	if (!origin || !href.startsWith("/")) return href;
	return new URL(href, origin).toString();
}

function normalizeEvidenceMarkdown(
	content: string,
	origin?: string,
	pdfSources: Record<string, string> = {},
) {
	let normalized = content.replace(
		/\[QUOTE\s*([\s\S]*?)\s*QUOTE\/\][\s.,]*/g,
		"\n> $1\n",
	);
	normalized = normalized.replace(
		new RegExp(String.raw`\[(?:PAGE\s*|${MISSING_PAGE_MARKER}|${LABELLED_PAGE_MARKER})(.*?)\s*PAGE\/\]`, "g"),
		(_match, citationTarget: string) =>
			parsePageCitations(citationTarget, pdfSources)
				.map((citation) =>
					citation.href
						? `[Source, p. ${citation.page}](${absoluteUrl(citation.href, origin)})`
						: `(Source unavailable, p. ${citation.page})`,
				)
				.join(" "),
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
		`<h3>Tool: ${escapeHtml(TOOL_TITLES[summary.title] ?? summary.title)}</h3>`,
		items.length ? `<ul>${items.join("")}</ul>` : "",
		summary.detail ? `<p>${escapeHtml(summary.detail)}</p>` : "",
		summary.error
			? `<p><strong>Error:</strong> ${escapeHtml(summary.error)}</p>`
			: "",
		"</section>",
	].join("\n");
}

type MarkdownToHtml = (markdown: string) => string;

function transcriptHeader(
	format: ChatTranscriptFormat,
	title: string,
): string[] {
	if (format === "markdown") return [`# ${title}`];
	if (format === "plaintext") return [title];
	return ["<article>", `<h1>${escapeHtml(title)}</h1>`];
}

function screeningSection(
	format: ChatTranscriptFormat,
	screening: ScreeningResultsData,
	labels: ChatTranscriptLabels,
	origin?: string,
): string[] {
	const generated = screeningExportContent(screening, origin);

	if (format === "markdown") {
		return [
			`## ${labels.smartScreening}`,
			generated.markdown.replace(/^# Smart Screening Results\n+/, ""),
		];
	}

	if (format === "plaintext") {
		return [
			labels.smartScreening,
			generated.plaintext.replace(/^Smart Screening Results\n+/, ""),
		];
	}

	return [
		'<section class="message screening-results">',
		`<h2>${escapeHtml(labels.smartScreening)}</h2>`,
		generated.html.replace("<h1>Smart Screening Results</h1>\n", ""),
		"</section>",
	];
}

function roleHeading(
	format: ChatTranscriptFormat,
	message: UIMessage,
	labels: ChatTranscriptLabels,
): string[] {
	const roleLabel = message.role === "user" ? labels.user : labels.assistant;

	if (format === "markdown") return [`## ${roleLabel}`];
	if (format === "plaintext") return [roleLabel];
	return [
		`<section class="message ${message.role}">`,
		`<h2>${escapeHtml(roleLabel)}</h2>`,
	];
}

function answerLines(
	format: ChatTranscriptFormat,
	markdown: string,
	markdownToHtml?: MarkdownToHtml,
): string[] {
	if (format === "markdown") return [markdown];
	if (format === "plaintext") return [markdownToPlainText(markdown)];
	return markdownToHtml ? [markdownToHtml(markdown)] : [];
}

function reasoningLines(
	format: ChatTranscriptFormat,
	markdown: string,
	label: string,
	markdownToHtml?: MarkdownToHtml,
): string[] {
	if (format === "markdown") return [`### ${label}`, markdown];
	if (format === "plaintext") return [label, markdownToPlainText(markdown)];
	if (!markdownToHtml) return [];
	return [
		'<section class="reasoning">',
		`<h3>${escapeHtml(label)}</h3>`,
		markdownToHtml(markdown),
		"</section>",
	];
}

function toolLines(
	format: ChatTranscriptFormat,
	part: ResearchToolPart,
	origin?: string,
): string[] {
	if (format === "markdown") return [markdownToolActivity(part, origin)];
	if (format === "plaintext") return [plaintextToolActivity(part, origin)];
	return [htmlToolActivity(part, origin)];
}

function messagePartLines(
	format: ChatTranscriptFormat,
	message: UIMessage,
	labels: ChatTranscriptLabels,
	markdownToHtml?: MarkdownToHtml,
	origin?: string,
	pdfSources?: Record<string, string>,
): string[] {
	return message.parts.flatMap((part) => {
		if (isTextUIPart(part) && part.text.trim()) {
			return answerLines(
				format,
				normalizeEvidenceMarkdown(part.text, origin, pdfSources),
				markdownToHtml,
			);
		}

		if (isReasoningUIPart(part) && part.text.trim()) {
			return reasoningLines(
				format,
				normalizeEvidenceMarkdown(part.text, origin, pdfSources),
				labels.reasoning,
				markdownToHtml,
			);
		}

		if (isToolUIPart(part)) return toolLines(format, part, origin);

		return [];
	});
}

/** The whole conversation as one document the reader can keep. */
export async function chatTranscriptContent(
	format: ChatTranscriptFormat,
	messages: UIMessage[],
	labels: ChatTranscriptLabels,
	origin?: string,
	/** The PDFs the conversation read, by file name: page citations link only to these. */
	pdfSources?: Record<string, string>,
) {
	const markdownToHtml =
		format === "html"
			? await createSafeMarkdownRenderer(origin)
			: undefined;
	const output = transcriptHeader(format, labels.title);

	for (const message of messages) {
		const screening = parseScreeningMessage(message);
		if (screening) {
			output.push(...screeningSection(format, screening, labels, origin));
			continue;
		}

		output.push(...roleHeading(format, message, labels));
		output.push(
			...messagePartLines(
				format,
				message,
				labels,
				markdownToHtml,
				origin,
				pdfSources,
			),
		);
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
	pdfSources?: Record<string, string>,
) {
	const content = message.parts
		.filter(isTextUIPart)
		.map((part) => part.text)
		.filter(Boolean)
		.join("\n\n");
	return evidenceContent(format, content, origin, pdfSources);
}

/** Shared export for an AI answer, summary, or explanation. */
export async function evidenceContent(
	format: ChatTranscriptFormat,
	content: string,
	origin?: string,
	pdfSources?: Record<string, string>,
) {
	const markdown = normalizeEvidenceMarkdown(content, origin, pdfSources);
	if (format === "markdown") return markdown;
	if (format === "plaintext") return markdownToPlainText(markdown);
	const markdownToHtml = await createSafeMarkdownRenderer(origin);
	return markdownToHtml(markdown);
}
