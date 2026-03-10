import { Link } from "@/i18n/routing";
import PolicyToc, { type PolicyTocSection } from "@/components/pages/PolicyToc";
import {
	ArrowLeft,
	CalendarDays,
	ChevronRight,
	FileText,
	Mail,
} from "lucide-react";
import { isValidElement } from "react";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { twMerge } from "tailwind-merge";

function formatLastUpdated(lastUpdated: Date) {
	return new Intl.DateTimeFormat("en-GB", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	}).format(lastUpdated);
}

function stripLeadingHeading(content: string) {
	return content.replace(/^#\s+.*\n+/, "");
}

function stripMarkdownDecorators(value: string) {
	return value
		.replace(/\*\*(.*?)\*\*/g, "$1")
		.replace(/__(.*?)__/g, "$1")
		.replace(/`(.*?)`/g, "$1")
		.replace(/\[(.*?)\]\((.*?)\)/g, "$1")
		.trim();
}

function slugify(value: string) {
	return stripMarkdownDecorators(value)
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^a-z0-9]+/g, "-")
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

function extractSections(content: string): PolicyTocSection[] {
	const sections = Array.from(
		content.matchAll(/^(#{1,3})\s+(.+)$/gm),
	).map(([_, hashes, rawTitle]) => ({
		id: slugify(rawTitle),
		level: Math.min(hashes.length, 3) as 1 | 2 | 3,
		title: stripMarkdownDecorators(rawTitle),
	}));

	const baseLevel =
		sections.length > 0
			? Math.min(...sections.map((section) => section.level))
			: 1;

	const seen = new Set<string>();

	return sections
		.map((section) => ({
			...section,
			level: Math.max(
				1,
				Math.min(3, section.level - baseLevel + 1),
			) as 1 | 2 | 3,
		}))
		.filter((section) => {
			if (!section.id || seen.has(section.id)) {
				return false;
			}

			seen.add(section.id);
			return true;
		});
}

function createHeading(level: "h1" | "h2" | "h3", className: string) {
	return function Heading({ children }: { children?: ReactNode }) {
		const headingText = getNodeText(children);
		const id = slugify(headingText);
		const Tag = level;

		return (
			<Tag id={id} tabIndex={-1} className={className}>
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

const markdownComponents: Components = {
	h1: createHeading(
		"h1",
		"group mb-6 mt-14 border-t border-black/8 pt-8 text-3xl font-semibold tracking-tight text-black first:mt-0 first:border-t-0 first:pt-0 dark:border-white/10 dark:text-white",
	),
	h2: createHeading(
		"h2",
		"group mb-5 mt-12 border-t border-black/8 pt-8 text-2xl font-semibold tracking-tight text-black first:mt-0 first:border-t-0 first:pt-0 dark:border-white/10 dark:text-white",
	),
	h3: createHeading(
		"h3",
		"group mb-4 mt-10 text-xl font-semibold tracking-tight text-black dark:text-white",
	),
	a: ({ href, children }) => {
		const url = href ?? "#";
		const isExternal =
			url.startsWith("http://") ||
			url.startsWith("https://") ||
			url.startsWith("mailto:");

		if (isExternal) {
			return (
				<a
					href={url}
					target={url.startsWith("mailto:") ? undefined : "_blank"}
					rel={
						url.startsWith("mailto:")
							? undefined
							: "noopener noreferrer"
					}
					className="font-medium text-link_light underline decoration-black/15 underline-offset-4 transition-colors hover:text-link hover:decoration-current dark:text-link dark:decoration-white/20"
				>
					{children}
				</a>
			);
		}

		return (
			<Link
				href={url}
				className="font-medium text-link_light underline decoration-black/15 underline-offset-4 transition-colors hover:text-link hover:decoration-current dark:text-link dark:decoration-white/20"
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
		<thead className="bg-black/[0.045] dark:bg-white/[0.05]">{children}</thead>
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

export default function PolicyPage({
	content,
	title,
	description,
	lastUpdated,
	otherPolicyLink,
	homeLabel,
	className,
}: {
	content: string;
	title: string;
	description: string;
	lastUpdated: Date;
	otherPolicyLink: {
		href: "/privacy" | "/cookie-policy";
		label: string;
	};
	homeLabel: string;
	className?: string;
}) {
	const articleContent = stripLeadingHeading(content);
	const sections = extractSections(articleContent);

	return (
		<main
			id="main-content"
			className="relative min-h-screen w-full overflow-x-clip px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-10 xl:px-12 xl:py-14"
		>
			<div className="pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2">
				<div className="absolute inset-x-0 -top-56 h-[42rem] bg-[radial-gradient(circle_at_top_left,rgba(230,129,36,0.18),transparent_38%),radial-gradient(circle_at_top_right,rgba(92,172,253,0.16),transparent_30%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(230,129,36,0.24),transparent_34%),radial-gradient(circle_at_top_right,rgba(92,172,253,0.16),transparent_26%)]" />
				<div className="absolute inset-x-0 bottom-0 h-[18rem] bg-[linear-gradient(180deg,transparent,rgba(15,15,15,0.02))] dark:bg-[linear-gradient(180deg,transparent,rgba(15,15,15,0.3))]" />
			</div>

			<div className="relative mx-auto flex min-w-0 max-w-7xl flex-col gap-6">
				<nav className="flex flex-wrap items-center gap-3 text-sm">
					<Link
						href="/"
						className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-black px-2.5 py-2 text-white shadow-[0_16px_40px_-28px_rgba(0,0,0,0.6)] transition-all hover:-translate-y-0.5 hover:bg-black/90 dark:border-accent/25 dark:bg-accent/14 dark:text-white dark:hover:bg-accent/18"
					>
						<span className="inline-flex size-8 items-center justify-center rounded-full bg-white/12 text-white dark:bg-accent/20">
							<ArrowLeft className="size-4" />
						</span>
						<span className="pr-2 font-medium tracking-tight">{homeLabel}</span>
					</Link>
					<Link
						href={otherPolicyLink.href}
						className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-background_light/900 px-4 py-2 text-black/72 transition-all hover:-translate-y-0.5 hover:bg-background_light/800 dark:border-white/10 dark:bg-secondary/92 dark:text-white/75 dark:hover:bg-card/92"
					>
						<FileText className="size-4" />
						{otherPolicyLink.label}
						<ChevronRight className="size-4" />
					</Link>
				</nav>

				<section className="relative min-w-0 overflow-hidden rounded-[2rem] border border-black/10 bg-gradient-to-br from-white via-background_light/900 to-accent/10 px-6 py-8 shadow-[0_28px_90px_-46px_rgba(0,0,0,0.28)] dark:border-white/10 dark:from-secondary dark:via-card dark:to-accent/15 sm:px-8 lg:px-10 lg:py-10">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.9),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(230,129,36,0.16),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.07),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(230,129,36,0.12),transparent_28%)]" />
					<div className="relative">
						<div className="space-y-5">
							<div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-background_light/800 px-4 py-2 text-xs font-medium text-black/65 dark:border-white/10 dark:bg-card/80 dark:text-white/65">
								<CalendarDays className="size-4" />
								Updated {formatLastUpdated(lastUpdated)}
							</div>

							<div className="max-w-3xl space-y-4">
								<h1 className="text-balance text-4xl font-semibold tracking-tight text-black sm:text-5xl dark:text-white">
									{title}
								</h1>
								<p className="max-w-2xl text-pretty text-base leading-7 text-black/70 sm:text-lg dark:text-white/70">
									{description}
								</p>
							</div>
						</div>
					</div>
				</section>

				<div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
					<section className="min-w-0 overflow-x-hidden rounded-[2rem] border border-black/10 bg-background_light/900 px-6 py-8 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.45)] dark:border-white/10 dark:bg-secondary/88 sm:px-8 lg:px-12 lg:py-12">
						<article
							className={twMerge(
								"prose prose-slate max-w-3xl break-words prose-headings:scroll-mt-28 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-black prose-p:text-black/72 prose-li:text-black/72 prose-strong:text-black prose-a:no-underline prose-th:border-none prose-td:border-none dark:prose-invert dark:prose-headings:text-white dark:prose-p:text-white/72 dark:prose-li:text-white/72 dark:prose-strong:text-white",
								className,
							)}
						>
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								components={markdownComponents}
							>
								{articleContent}
							</ReactMarkdown>
						</article>
					</section>

					<aside className="hidden xl:block">
						<div className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col gap-4">
							<PolicyToc sections={sections} />

							<div className="shrink-0 rounded-[1.75rem] border border-black/10 bg-gradient-to-br from-background_light/800 to-accent/10 p-5 dark:border-white/10 dark:from-secondary dark:to-accent/12">
								<div className="mb-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-black/45 dark:text-white/45">
									<Mail className="size-4 text-accent" />
									Questions
								</div>
								<p className="mb-4 text-sm leading-6 text-black/70 dark:text-white/70">
									If you need clarification about this notice, contact the
									team directly.
								</p>
								<a
									href="mailto:contact@opendeved.net"
									className="inline-flex items-center gap-2 text-sm font-medium text-accent transition-transform hover:translate-x-0.5"
								>
									contact@opendeved.net
									<ChevronRight className="size-4" />
								</a>
							</div>
						</div>
					</aside>
				</div>
			</div>
		</main>
	);
}
