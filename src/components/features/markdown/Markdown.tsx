"use client";

import remarkGfm from "remark-gfm";
import { Node } from "unist";
import { visit } from "unist-util-visit";
import { PropsWithChildren, ReactNode } from "react";
import { BiSolidBookBookmark, BiSolidBookContent } from "react-icons/bi";
import { twMerge } from "tailwind-merge";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import Resource from "../items/Resource";
import React from "react";
import { Card } from "@/components/nextui/Card";

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
					children: [{
						type: "text",
						value: className === "QuoteHighlight"
							? captured.replace(/\\n/g, '\n')
							: captured
					}],
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
export const rehypeResourceWrapper = createRehypeWrapperForTag(
	"RESOURCE",
	"ResourceWrapper"
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
			<Card className="inline-flex flex-row items-center gap-0.5 px-2 py-0 h-fit">
				<BiSolidBookBookmark className="text-accent-400 size-3" />
				<span className="text-xs font-normal">P.</span>
				<span className="text-sm font-medium">
					{children}
				</span>
			</Card>
		);
	}

	return (
		<Card className="inline-flex flex-row items-center gap-0.5 px-2 py-0 h-fit">
			<BiSolidBookContent className="text-accent-400" />
			<span className="dark:text-white/60 text-black/60 text-xs font-normal">Section</span>
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
	const key = children?.toString().split('/').pop();

	return <ul className="[&:has(_.no-data)]:hidden">
		<Resource itemKey={key} abstract={true} className="my-2" />
	</ul>
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
					) : className === "ResourceWrapper" ? (
						<ResourceWrapper>
							{children}
						</ResourceWrapper>
					) : (
						<span>{children}</span>
					),
				a: ({ href, children }) =>
					href?.startsWith("/") ? (
						<ResourceWrapper>{href}</ResourceWrapper>
					) : (
						<a href={href} className="text-link underline" target="_blank" rel="noopener noreferrer">
							{children}
						</a>
					),
				p: ({ children, ...props }) => (
					<div {...props}>
						{children}
					</div>
				),
			}}
			className={twMerge(className)}
			{...props}
		>
			{children as string}
		</ReactMarkdown>
	);
}
