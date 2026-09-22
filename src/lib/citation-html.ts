import { htmlToDOM, type DOMNode } from "html-react-parser";
import serialize from "dom-serializer";

const tags = new Set(["div", "span", "i", "em", "b", "strong", "sup", "sub"]);
const classes = new Set([
	"csl-entry",
	"csl-block",
	"csl-left-margin",
	"csl-right-inline",
	"csl-indent",
]);
const typography = new Set([
	"font-style:normal",
	"font-variant:small-caps",
	"font-variant:normal",
	"font-weight:normal",
	"text-decoration:underline",
	"text-decoration:none",
]);

function citationHref(value: string | undefined) {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return ["https:", "http:"].includes(url.protocol)
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}

function formattingAttributes(
	attributes: Record<string, string>,
): Record<string, string> {
	const allowed: Record<string, string> = {};
	if (classes.has(attributes.class)) allowed.class = attributes.class;
	const style = (attributes.style ?? "")
		.split(";")
		.map((rule) => rule.replace(/\s/g, ""))
		.filter((rule) => typography.has(rule))
		.join(";");
	if (style) allowed.style = style;
	return allowed;
}

function cleanNode(node: DOMNode): DOMNode[] {
	if (node.type === "text") return [node];
	if (node.type !== "tag") return [];
	if (!tags.has(node.name) && node.name !== "a") return [];
	const children = (node.children as DOMNode[]).flatMap(cleanNode);
	if (node.name === "a") {
		const href = citationHref(node.attribs.href);
		if (!href) return children;
		node.attribs = { href, target: "_blank", rel: "noopener noreferrer" };
	} else {
		node.attribs = formattingAttributes(node.attribs);
	}
	node.children = children;
	return [node];
}

/** Shared by the React preview and standalone HTML downloads. */
export function citationHtmlNodes(html: string): DOMNode[] {
	return htmlToDOM(html).flatMap(cleanNode);
}

export function citationHtml(html: string): string {
	return serialize(citationHtmlNodes(html));
}
