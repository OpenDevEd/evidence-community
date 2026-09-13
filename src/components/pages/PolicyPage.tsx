import { lexer, type Token } from "marked";
import { Link } from "@/i18n/routing";
import { isValidElement } from "react";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PolicyLayout from "./PolicyLayout";
import PolicyEmailCopyButton from "./PolicyEmailCopyButton";

function formatLastUpdated(lastUpdated: Date) {
	return new Intl.DateTimeFormat("en-GB", {
		day: "2-digit",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(lastUpdated);
}

function inlineText(tokens: Token[]): string {
	return tokens
		.map((token) => {
			if (token.type === "br") return " ";
			if ("tokens" in token && token.tokens)
				return inlineText(token.tokens);
			return "text" in token ? token.text : "";
		})
		.join("");
}

function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}

function getNodeText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map(getNodeText).join("");
	}

	if (isValidElement<{ children?: ReactNode }>(node)) {
		return getNodeText(node.props.children);
	}

	return "";
}

const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
type HeadingTag = (typeof headingTags)[number];
const headingClasses: Partial<Record<HeadingTag, string>> = {
	h1: "group mb-6 mt-14 border-t border-black/8 pt-8 text-3xl font-semibold tracking-tight text-black first:mt-0 first:border-t-0 first:pt-0 dark:border-white/10 dark:text-white",
	h2: "group mb-5 mt-12 border-t border-black/8 pt-8 text-2xl font-semibold tracking-tight text-black first:mt-0 first:border-t-0 first:pt-0 dark:border-white/10 dark:text-white",
	h3: "group mb-4 mt-10 text-xl font-semibold tracking-tight text-black dark:text-white",
};

function createHeading(level: HeadingTag, chapterLevel?: number) {
	return function Heading({ children }: { children?: ReactNode }) {
		const headingText = getNodeText(children);
		const id = slugify(headingText);
		const Tag =
			chapterLevel === undefined
				? level
				: headingTags[
						Math.min(
							5,
							Math.max(2, Number(level[1]) - chapterLevel + 1),
						)
					];

		return (
			<Tag
				id={id}
				tabIndex={-1}
				className={headingClasses[level]}
				data-policy-heading={level}
			>
				<a
					href={`#${id}`}
					className="inline-flex items-start gap-3 no-underline transition-colors hover:text-accent"
				>
					<span>{children}</span>
					<span
						aria-hidden="true"
						className="mt-1 text-xs font-semibold uppercase tracking-[0.24em] text-black/25 opacity-0 transition-opacity group-hover:opacity-100 dark:text-white/25"
					>
						#
					</span>
				</a>
			</Tag>
		);
	};
}

function emailFromLink(url: string) {
	const email = /^mailto:([^?]+)/i.exec(url)?.[1];
	if (!email) return undefined;
	try {
		return decodeURIComponent(email);
	} catch {
		return undefined;
	}
}

const markdownComponents: Components = {
	a: ({ href, children }) => {
		const url = href ?? "#";
		const isEmail = /^mailto:/i.test(url);
		const email = emailFromLink(url);
		const isExternal =
			url.startsWith("http://") || url.startsWith("https://") || isEmail;

		if (isExternal) {
			const link = (
				<a
					href={url}
					target={isEmail ? undefined : "_blank"}
					rel={isEmail ? undefined : "noopener noreferrer"}
					className="min-w-0 font-medium text-link underline decoration-black/15 underline-offset-4 transition-colors hover:decoration-current dark:decoration-white/20"
				>
					{children}
				</a>
			);
			return email ? (
				<span className="inline-flex max-w-full items-baseline gap-3">
					{link}
					<PolicyEmailCopyButton email={email} />
				</span>
			) : (
				link
			);
		}

		return (
			<Link
				href={url}
				className="font-medium text-link underline decoration-black/15 underline-offset-4 transition-colors hover:decoration-current dark:decoration-white/20"
			>
				{children}
			</Link>
		);
	},
	p: ({ children }) => (
		<p className="text-[1.02rem] leading-8 text-black/72 dark:text-white/72">
			{children}
		</p>
	),
	table: ({ children }) => (
		<div className="my-8 overflow-x-auto rounded-[1.75rem] border border-black/10 bg-background_light/800 shadow-[0_24px_60px_-46px_rgba(0,0,0,0.45)] first:mt-0 last:mb-0 dark:border-white/10 dark:bg-card/92">
			<table className="w-full min-w-[42rem] border-collapse text-sm !my-0">
				{children}
			</table>
		</div>
	),
	thead: ({ children }) => (
		<thead className="bg-black/[0.045] dark:bg-white/[0.05]">
			{children}
		</thead>
	),
	th: ({ children }) => (
		<th className="px-4 py-3 text-left text-[0.8rem] font-semibold uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
			{children}
		</th>
	),
	td: ({ children }) => (
		<td className="border-t border-black/8 px-4 py-3 align-top text-black/72 dark:border-white/10 dark:text-white/72">
			{children}
		</td>
	),
	ul: ({ children }) => (
		<ul className="space-y-3 pl-5 marker:text-accent">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="space-y-3 pl-5 marker:font-semibold marker:text-accent">
			{children}
		</ol>
	),
	li: ({ children }) => (
		<li className="pl-1 text-black/72 dark:text-white/72">{children}</li>
	),
	blockquote: ({ children }) => (
		<blockquote className="rounded-[1.5rem] border border-accent/15 bg-gradient-to-br from-accent/8 to-transparent px-5 py-4 text-black/75 not-italic dark:border-accent/20 dark:from-accent/12 dark:text-white/75">
			{children}
		</blockquote>
	),
	hr: () => (
		<hr className="my-10 border-t border-dashed border-black/10 dark:border-white/10" />
	),
	code: ({ children, className }) => {
		if (className) {
			return (
				<code className="block overflow-x-auto rounded-2xl bg-black px-4 py-4 text-sm text-white dark:bg-black/80">
					{children}
				</code>
			);
		}

		return (
			<code className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[0.92em] text-black dark:bg-white/[0.08] dark:text-white">
				{children}
			</code>
		);
	},
};

function uniqueSectionId(title: string, ids: Set<string>) {
	const base = slugify(title) || "section";
	let id = base;
	for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
	ids.add(id);
	return id;
}

function readChapters(content: string) {
	const tokens = lexer(content);
	if (tokens[0]?.type === "heading" && tokens[0].depth === 1) tokens.shift();
	const level = Math.min(
		...tokens.map((token) =>
			token.type === "heading" ? token.depth : Infinity,
		),
	);
	const definitions = tokens
		.filter((token) => token.type === "def")
		.map((token) => token.raw)
		.join("\n");
	const chapters: { id: string; title: string; content: string }[] = [];
	const ids = new Set<string>();
	let intro = "";
	for (const token of tokens) {
		if (token.type === "heading" && token.depth === level) {
			const title = inlineText(token.tokens);
			const id = uniqueSectionId(title, ids);
			chapters.push({
				id,
				title,
				content: "",
			});
		} else {
			const chapter = chapters.at(-1);
			if (chapter) chapter.content += token.raw;
			else intro += token.raw;
		}
	}
	return { intro, chapters, definitions, level };
}

export default function PolicyPage({
	content,
	title,
	description,
	lastUpdated,
	otherPolicyLink,
	contactEmail,
}: {
	content: string;
	title: string;
	description: string;
	lastUpdated: Date;
	otherPolicyLink: {
		href: string;
		label: string;
	};
	contactEmail?: string;
}) {
	const { intro, chapters, definitions, level } = readChapters(content);
	const render = (text: string, chapterLevel?: number) =>
		text.trim() ? (
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					...markdownComponents,
					...Object.fromEntries(
						headingTags.map((tag) => [
							tag,
							createHeading(tag, chapterLevel),
						]),
					),
				}}
			>{`${text}\n\n${definitions}`}</ReactMarkdown>
		) : null;
	return (
		<PolicyLayout
			key={title}
			title={title}
			description={description}
			updated={formatLastUpdated(lastUpdated)}
			updatedISO={lastUpdated.toISOString()}
			contactEmail={contactEmail}
			otherPolicyLink={otherPolicyLink}
			intro={render(intro)}
			sections={chapters.map((chapter) => ({
				id: chapter.id,
				title: chapter.title,
				body: render(chapter.content, level),
			}))}
		/>
	);
}
