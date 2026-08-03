import type { Element, Root } from "hast";
import { toText } from "hast-util-to-text";
import rehypeParse from "rehype-parse";
import rehypeSanitize, { type Options as SanitizeSchema } from "rehype-sanitize";
import { unified, type Plugin } from "unified";
import { visit } from "unist-util-visit";

const ZOTERO_SMALL_CAPS_CLASS = "zotero-small-caps";

const zoteroMarkupSchema: SanitizeSchema = {
	allowComments: false,
	allowDoctypes: false,
	ancestors: {},
	attributes: {
		span: [["className", ZOTERO_SMALL_CAPS_CLASS]],
	},
	clobber: [],
	clobberPrefix: "zotero-",
	protocols: {},
	required: {},
	strip: [
		"embed",
		"iframe",
		"math",
		"object",
		"script",
		"style",
		"svg",
		"template",
	],
	tagNames: ["b", "br", "em", "i", "p", "span", "strong", "sub", "sup"],
};

function isSmallCapsStyle(value: unknown): boolean {
	if (typeof value !== "string") return false;

	const declarations = value
		.split(";")
		.map((declaration) => declaration.trim())
		.filter(Boolean);

	return (
		declarations.length === 1 &&
		/^font-variant\s*:\s*small-caps$/i.test(declarations[0])
	);
}

const normalizeZoteroMarkup: Plugin<[], Root> = () => (tree: Root) => {
	visit(tree, "element", (node: Element) => {
		if (node.tagName === "i") node.tagName = "em";
		if (node.tagName === "b") node.tagName = "strong";

		const smallCaps =
			node.tagName === "span" && isSmallCapsStyle(node.properties.style);

		// Zotero fields are untrusted HTML fragments. Discard every source
		// attribute, then restore only the one presentation we explicitly support.
		node.properties = smallCaps
			? { className: [ZOTERO_SMALL_CAPS_CLASS] }
			: {};
	});
};

const sanitizedTreeProcessor = unified()
	.use(rehypeParse, { fragment: true })
	.use(normalizeZoteroMarkup)
	.use(rehypeSanitize, zoteroMarkupSchema);

export function parseSanitizedZoteroMarkup(markup: string): Root {
	const tree = sanitizedTreeProcessor.parse(markup);
	return sanitizedTreeProcessor.runSync(tree) as Root;
}

export function zoteroMarkupToPlainText(markup: string | null | undefined): string {
	if (!markup) return "";

	return toText(parseSanitizedZoteroMarkup(markup), {
		whitespace: "pre-wrap",
	})
		.replace(/\u00a0/g, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function zoteroMarkupToSingleLine(
	markup: string | null | undefined,
): string {
	return zoteroMarkupToPlainText(markup).replace(/\s+/g, " ").trim();
}
