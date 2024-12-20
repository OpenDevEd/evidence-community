"use client";

import remarkGfm from "remark-gfm";
import { Node } from "unist";
import { visit } from "unist-util-visit";
import { PropsWithChildren, ReactNode } from "react";
import { BiSolidBookBookmark, BiSolidBookContent } from "react-icons/bi";
import { twMerge } from "tailwind-merge";
import ReactMarkdown from "react-markdown";

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
					children: [{ type: "text", value: captured }],
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
	const regex = new RegExp(`\\(?\\[${tag} (.*?) ${tag}\\/\\.?\\]\\)?\\.?`, "g");
	return createRehypeWrapper(regex, className);
}

export const rehypeQuoteWrapper = createRehypeWrapperForTag(
	"QUOTE",
	"QuoteHighlight"
);
export const rehypePageWrapper = createRehypeWrapperForTag(
	"PAGE",
	"PageHighlight"
);
export const rehypeSectionWrapper = createRehypeWrapperForTag(
	"SECTION",
	"SectionHighlight"
);

function Highlight({
	children,
	className,
}: {
	children: ReactNode;
	className: string;
}) {
	if (className === "PageHighlight") {
		return (
			<span className="font-medium inline-flex items-center gap-1 bg-black/50 text-white border border-white/20 rounded-md px-2 py-0.5 text-xs ml-1">
				<BiSolidBookBookmark className="text-tertiary-400" />
				<span className="text-white/60 text-xs font-normal">Page</span>
				<span className="text-white text-sm font-medium">
					{children}
				</span>
			</span>
		);
	}

	return (
		<span className="font-medium inline-flex items-center gap-1 bg-black/50 text-white border border-white/20 rounded-md px-2 py-0.5 text-xs ml-1">
			<BiSolidBookContent className="text-accent-400" />
			<span className="text-white/60 text-xs font-normal">Section</span>
			<span className="text-white text-sm font-medium">
				{children}
			</span>
		</span>
	);
}

function QuoteHighlight({ children }: { children: ReactNode }) {
	return (
		<span className="italic font-normal text-white border-l-4 border-tertiary-400/50 pl-3 py-1 my-1 block bg-black/10 rounded-lg">
			{children}
		</span>
	);
}

export function AIMarkdown({
	children,
	className,
	...props
}: PropsWithChildren<{ className?: string }>) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			rehypePlugins={[
				rehypeQuoteWrapper,
					rehypePageWrapper,
					rehypeSectionWrapper,
			]}
			components={{
				span: ({ children, className }) =>
					className === "PageHighlight" ||
					className === "SectionHighlight" ? (
						<Highlight className={className}>{children}</Highlight>
					) : className === "QuoteHighlight" ? (
						<QuoteHighlight>{children}</QuoteHighlight>
					) : (
						<span>{children}</span>
					),
			}}
			className={twMerge(
				className
			)}
			{...props}
		>
			{children as string}
		</ReactMarkdown>
	);
}
