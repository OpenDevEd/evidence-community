"use client";

import { Node } from "unist";
import { visit } from "unist-util-visit";
import {
	ComponentProps,
	PropsWithChildren,
	ReactNode,
	useMemo,
} from "react";
import { BiSolidBookContent } from "react-icons/bi";
import { twMerge } from "tailwind-merge";
import { defaultRehypePlugins, Streamdown, type Components } from "streamdown";
import Link from "next/link";
import Resource from "../items/Resource";
import { Card } from "@/components/nextui/Card";
import { LABELLED_PAGE_MARKER, parsePageCitation } from "@/lib/ai/citations";
import {
	PageCitation,
	PublicationLink,
} from "@/components/features/markdown/Citation";

function createRehypeWrapper(pattern: RegExp, className: string) {
	return () => (tree: Node) => {
		visit(tree, "text", (node: any, index: number, parent: any) => {
			const { value } = node;
			let match;
			const nodes = [];
			let lastIndex = 0;

			while ((match = pattern.exec(value)) !== null) {
				const [fullMatch, captured] = match;
				const start = match.index;

				if (start > lastIndex) {
					nodes.push({
						type: "text",
						value: value.slice(lastIndex, start),
					});
				}

				nodes.push({
					type: "element",
					tagName: "span",
					properties: { className: [className] },
					children: [
						{
							type: "text",
							value:
								className === "QuoteHighlight"
									? captured.replace(/\\n/g, "\n")
									: captured,
						},
					],
				});

				lastIndex = pattern.lastIndex;
			}

			if (lastIndex < value.length) {
				nodes.push({
					type: "text",
					value: value.slice(lastIndex),
				});
			}

			if (nodes.length > 0) {
				parent.children.splice(index, 1, ...nodes);
				return index + nodes.length;
			}
		});
	};
}

function createRehypeWrapperForTag(tag: string, className: string) {
	const regex = new RegExp(
		`\\(?\\[${tag} (.*?) ${tag}\\/\\.?\\]\\)?\\.?`,
		"g",
	);
	return createRehypeWrapper(regex, className);
}

export const rehypeQuoteWrapper = createRehypeWrapperForTag(
	"QUOTE",
	"QuoteHighlight",
);
export const rehypePageWrapper = createRehypeWrapper(
	new RegExp(
		String.raw`\(?\[(?:PAGE |${LABELLED_PAGE_MARKER})(.*?) PAGE\/\.?\]\)?\.?`,
		"g",
	),
	"PageHighlight",
);
export const rehypeSectionWrapper = createRehypeWrapperForTag(
	"SECTION",
	"SectionHighlight",
);

const publicationHrefPattern = /^\/lib\/([^/?#]+)\/?(?:[?#].*)?$/;
const resourceTokenPattern =
	/^\s*\[RESOURCE\s+(\/lib\/[^/?#\s]+)\s+RESOURCE\/\]\s*$/;

function resourceWrapperNode(href: string) {
	return {
		type: "element",
		tagName: "span",
		properties: { className: ["ResourceWrapper"] },
		children: [{ type: "text", value: href }],
	};
}

function rehypeResourceCards() {
	return (tree: Node) => {
		visit(tree, "element", (node: any, index: number, parent: any) => {
			if (node.tagName !== "p" || typeof index !== "number" || !parent) {
				return;
			}

			if (node.children.some((child: any) => child.type !== "text")) return;
			const token = node.children
				.map((child: any) => child.value)
				.join("")
				.match(resourceTokenPattern);
			if (!token) return;

			parent.children.splice(index, 1, resourceWrapperNode(token[1]));
			return index + 1;
		});
	};
}

// Models sometimes write links without the leading slash or scheme —
// `[Title](lib/KEY)`, `[Title](KEY)`, `[DOI](doi.org/…)`, `[site](www.…)`.
// Streamdown's link sanitiser (rehype-harden) cannot parse those and would
// render the text with a " [blocked]" suffix. Repair the recognisable shapes
// into valid URLs before it runs.
const ITEM_KEY_PATTERN = /^[A-Z0-9]{8}$/;
function repairHref(href: unknown): unknown {
	if (typeof href !== "string") return href;
	const value = href.trim();
	if (!value) return href;
	if (/^(?:[a-z][a-z0-9+.-]*:|\/|#|\.\.?\/)/i.test(value)) return href;
	if (ITEM_KEY_PATTERN.test(value)) return `/lib/${value}`;
	const libMatch = value.match(/^lib\/([A-Z0-9]{8})(.*)$/i);
	if (libMatch) return `/lib/${libMatch[1]}${libMatch[2]}`;
	if (/^(?:www\.|doi\.org\/|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/|$))/i.test(value)) {
		return `https://${value}`;
	}
	return href;
}
function rehypeRepairLinks() {
	return (tree: Node) => {
		visit(tree, "element", (node: any) => {
			if (node.tagName !== "a" || !node.properties) return;
			node.properties.href = repairHref(node.properties.href);
		});
	};
}

// Same defaults Streamdown ships, except unresolvable links degrade to plain
// text instead of text + " [blocked]".
type RehypePlugins = ComponentProps<typeof Streamdown>["rehypePlugins"];
type RehypePlugin = NonNullable<RehypePlugins>[number];
const defaults = defaultRehypePlugins as unknown as {
	raw: RehypePlugin;
	sanitize: RehypePlugin;
	harden: [RehypePlugin, Record<string, unknown>];
};
const hardenWithTextFallback = [
	defaults.harden[0],
	{ ...defaults.harden[1], linkBlockPolicy: "text-only" },
] as unknown as RehypePlugin;

const rehypePlugins: NonNullable<RehypePlugins> = [
	defaults.raw,
	defaults.sanitize,
	rehypeRepairLinks,
	hardenWithTextFallback,
	rehypeQuoteWrapper,
	rehypePageWrapper,
	rehypeSectionWrapper,
	rehypeResourceCards,
];

const EMPTY_PDF_SOURCES: Record<string, string> = {};

function Highlight({
	children,
	className,
	pdfSources,
}: {
	children: ReactNode;
	className: string;
	pdfSources: Record<string, string>;
}) {
	if (className === "PageHighlight") {
		const citation = parsePageCitation(
			children?.toString() ?? "",
			pdfSources,
		);
		return <PageCitation href={citation.href} page={citation.page} />;
	}

	return (
		<Card className="inline-flex flex-row items-center gap-0.5 px-2 py-0 h-fit">
			<BiSolidBookContent className="text-accent-400" />
			<span className="dark:text-white/60 text-black/60 text-xs font-normal">
				Section
			</span>
			<span className="dark:text-white text-black text-sm font-medium">
				{children}
			</span>
		</Card>
	);
}

function Quote({
	as: Tag = "blockquote",
	children,
}: {
	as?: "blockquote" | "span";
	children: ReactNode;
}) {
	return (
		<Tag className="not-prose relative my-6 block pl-9 pr-2 font-serif text-[1.08em] italic leading-[1.7] tracking-[0.005em] text-black/80 before:pointer-events-none before:absolute before:-top-3 before:left-0 before:font-serif before:text-[3rem] before:font-bold before:not-italic before:leading-none before:text-accent/40 before:content-['“'] dark:text-white/80 dark:before:text-accent/50 [&>p]:my-0 [&>p+p]:mt-3">
			{children}
		</Tag>
	);
}

function QuoteHighlight({ children }: { children: ReactNode }) {
	return <Quote as="span">{children}</Quote>;
}

function ResourceWrapper({ children }: { children: ReactNode }) {
	const href = children?.toString() ?? "";
	const key = href.match(publicationHrefPattern)?.[1];
	if (!key) return null;

	return (
		<div className="mb-6 inline-block w-full align-top [&:has(_.no-data)]:hidden">
			<Resource
				itemKey={key}
				abstract={true}
				className="my-0"
				as="div"
				openLinksInNewTab
			/>
		</div>
	);
}

export function AIMarkdown({
	children,
	className,
	pdfSources = EMPTY_PDF_SOURCES,
	isAnimating = false,
	...props
}: PropsWithChildren<{
	className?: string;
	pdfSources?: Record<string, string>;
	isAnimating?: boolean;
}>) {
	const components = useMemo<Components>(() => ({
		// Heading scale follows BeeWriter's default document style (eKitabu01 /
		// OpenDevEd01): accent H1, accent-underlined H2. H3 keeps BeeWriter's size and
		// rule but uses the body colour instead of its navy brand colour.
		h1: ({ children, className, ...rest }) => (
			<h1
				className={twMerge(
					className,
					"mb-[1.08em] mt-[2.67em] text-[1.75em] font-bold leading-tight text-accent first:mt-0",
				)}
				{...rest}
			>
				{children}
			</h1>
		),
		h2: ({ children, className, ...rest }) => (
			<h2
				className={twMerge(
					className,
					"mb-[0.92em] mt-[1.58em] border-b border-accent pb-1 text-[1.333em] font-bold leading-tight text-black first:mt-0 dark:text-white",
				)}
				{...rest}
			>
				{children}
			</h2>
		),
		h3: ({ children, className, ...rest }) => (
			<h3
				className={twMerge(
					className,
					"mb-[0.92em] mt-[1.58em] border-b border-black/10 pb-0.5 text-[1.167em] font-bold leading-tight text-black first:mt-0 dark:border-white/15 dark:text-white",
				)}
				{...rest}
			>
				{children}
			</h3>
		),
		h4: ({ children, className, ...rest }) => (
			<h4
				className={twMerge(
					className,
					"my-[0.33em] text-[1.083em] font-bold leading-tight text-black first:mt-0 dark:text-white",
				)}
				{...rest}
			>
				{children}
			</h4>
		),
		h5: ({ children, className, ...rest }) => (
			<h5
				className={twMerge(
					className,
					"my-[1.08em] text-[1em] font-bold leading-tight text-black first:mt-0 dark:text-white",
				)}
				{...rest}
			>
				{children}
			</h5>
		),
		h6: ({ children, className, ...rest }) => (
			<h6
				className={twMerge(
					className,
					"mb-[0.42em] mt-[1.33em] text-[1em] font-bold leading-tight text-black first:mt-0 dark:text-white",
				)}
				{...rest}
			>
				{children}
			</h6>
		),
		blockquote: ({ children }) => <Quote>{children}</Quote>,
		ol: ({ children, className }) => (
			<ol className={twMerge(className, "list-decimal list-outside pl-6")}>
				{children}
			</ol>
		),
		span: ({ children, className }) =>
			className === "PageHighlight" ||
			className === "SectionHighlight" ? (
				<Highlight className={className} pdfSources={pdfSources}>
					{children}
				</Highlight>
			) : className === "QuoteHighlight" ? (
				<QuoteHighlight>{children}</QuoteHighlight>
			) : className === "ResourceWrapper" ? (
				<ResourceWrapper>{children}</ResourceWrapper>
			) : (
				<span>{children}</span>
			),
		a: ({ href, children }) => {
			const publicationKey = href?.match(publicationHrefPattern)?.[1];
			return publicationKey && href ? (
				<PublicationLink href={href} itemKey={publicationKey}>
					{children}
				</PublicationLink>
			) : href?.startsWith("/") ? (
				<Link
					href={href}
					className="text-link underline"
					target="_blank"
					rel="noopener noreferrer"
				>
					{children}
				</Link>
			) : (
				<a
					href={href}
					className="text-link underline"
					target="_blank"
					rel="noopener noreferrer"
				>
					{children}
				</a>
			);
		},
		table: ({ children, className, style }) => (
			<div className="my-6 w-full overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-secondary">
				<table
					className={twMerge(
						"m-0 w-full min-w-[40rem] border-collapse text-left text-sm",
						className,
					)}
					style={style}
				>
					{children}
				</table>
			</div>
		),
		thead: ({ children }) => (
			<thead className="bg-black/[0.035] dark:bg-white/[0.055]">
				{children}
			</thead>
		),
		tr: ({ children }) => (
			<tr className="border-b border-black/10 last:border-b-0 dark:border-white/10">
				{children}
			</tr>
		),
		th: ({ children, style }) => (
			<th
				className="px-4 py-3 align-top font-semibold text-black/80 dark:text-white/85"
				style={style}
			>
				{children}
			</th>
		),
		td: ({ children, style }) => (
			<td
				className="px-4 py-3 align-top text-black/70 dark:text-white/70"
				style={style}
			>
				{children}
			</td>
		),
	}), [pdfSources]);

	return (
		<Streamdown
			rehypePlugins={rehypePlugins}
			components={components}
			className={twMerge("ai-markdown", className)}
			mode={isAnimating ? "streaming" : "static"}
			isAnimating={isAnimating}
			controls={false}
			{...props}
		>
			{children as string}
		</Streamdown>
	);
}
