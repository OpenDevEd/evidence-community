"use client";

import { visit } from "unist-util-visit";

// The tree shape the visitor works on, taken from the visitor itself so no
// extra package is needed for one type.
type Node = Parameters<typeof visit>[0];
import { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { BiSolidBookBookmark, BiSolidBookContent } from "react-icons/bi";
import { twMerge } from "tailwind-merge";
import { defaultRehypePlugins, Streamdown, type Components } from "streamdown";
import Link from "next/link";
import Resource from "../items/Resource";
import React from "react";
import { Card } from "@/components/nextui/Card";
import { parsePageCitation } from "@/lib/ai/citations";
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
export const rehypePageWrapper = createRehypeWrapperForTag(
	"PAGE",
	"PageHighlight",
);
export const rehypeSectionWrapper = createRehypeWrapperForTag(
	"SECTION",
	"SectionHighlight",
);
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

/** A card only replaces a paragraph that is nothing but a RESOURCE token. */
function rehypeResourceCards() {
	return (tree: Node) => {
		visit(tree, "element", (node: any, index: number, parent: any) => {
			if (node.tagName !== "p" || typeof index !== "number" || !parent) {
				return;
			}
			if (node.children.some((child: any) => child.type !== "text"))
				return;

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
// The link sanitiser cannot parse those and would render the text with a
// " [blocked]" suffix. Repair the recognisable shapes before it runs.
const ITEM_KEY_PATTERN = /^[A-Z0-9]{8}$/;

function repairHref(href: unknown): unknown {
	if (typeof href !== "string") return href;
	const value = href.trim();
	if (!value) return href;
	if (/^(?:[a-z][a-z0-9+.-]*:|\/|#|\.\.?\/)/i.test(value)) return href;
	if (ITEM_KEY_PATTERN.test(value)) return `/lib/${value}`;
	const libMatch = value.match(/^lib\/([A-Z0-9]{8})(.*)$/i);
	if (libMatch) return `/lib/${libMatch[1]}${libMatch[2]}`;
	if (
		/^(?:www\.|doi\.org\/|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/|$))/i.test(value)
	) {
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

// The renderer's own defaults, except an unresolvable link degrades to plain
// text instead of text plus " [blocked]".
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

const publicationHrefPattern = /^\/lib\/([^/?#]+)\/?(?:[?#].*)?$/;

function publicationKey(href: unknown) {
	return typeof href === "string"
		? href.match(publicationHrefPattern)?.[1]
		: undefined;
}

function PageCitationSpan({
	children,
	pdfSources,
}: {
	children: ReactNode;
	pdfSources: Record<string, string>;
}) {
	const { page, href } = parsePageCitation(
		String(children ?? ""),
		pdfSources,
	);
	return <PageCitation href={href} page={page} />;
}

function SectionHighlight({ children }: { children: ReactNode }) {
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

function QuoteHighlight({ children }: { children: ReactNode }) {
	return (
		<span className="italic font-normal text-black dark:text-white border-l-4 border-tertiary-400/50 pl-3 py-1 my-1 block bg-black/10 rounded-lg">
			{children}
		</span>
	);
}

function ResourceWrapper({ children }: { children: ReactNode }) {
	const key = children?.toString().split("/").pop();

	return (
		<ul className="[&:has(_.no-data)]:hidden">
			<Resource itemKey={key} abstract={true} className="my-2" />
		</ul>
	);
}

const EMPTY_PDF_SOURCES: Record<string, string> = {};

export function AIMarkdown({
	children,
	className,
	isAnimating = false,
	pdfSources = EMPTY_PDF_SOURCES,
	...props
}: PropsWithChildren<{
	className?: string;
	isAnimating?: boolean;
	pdfSources?: Record<string, string>;
}>) {
	const components: Components = {
		span: ({ children, className }) =>
			className === "PageHighlight" ? (
				<PageCitationSpan pdfSources={pdfSources}>
					{children}
				</PageCitationSpan>
			) : className === "SectionHighlight" ? (
				<SectionHighlight>{children}</SectionHighlight>
			) : className === "QuoteHighlight" ? (
				<QuoteHighlight>{children}</QuoteHighlight>
			) : className === "ResourceWrapper" ? (
				<ResourceWrapper>{children}</ResourceWrapper>
			) : (
				<span>{children}</span>
			),
		// A titled link to a publication stays a link, marked as this
		// library's own. Only the RESOURCE token becomes a full card.
		a: ({ href, children }) =>
			publicationKey(href) ? (
				<PublicationLink
					href={href as string}
					itemKey={publicationKey(href) as string}
				>
					{children}
				</PublicationLink>
			) : href?.startsWith("/") ? (
				<Link href={href} className="text-link underline">
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
			),
		p: ({ children, ...rest }) => <div {...rest}>{children}</div>,
	};

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
