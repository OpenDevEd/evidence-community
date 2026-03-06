import { Link } from "@/i18n/routing";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { twMerge } from "tailwind-merge";

const markdownComponents: Components = {
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
					className="text-link_light underline underline-offset-4 dark:text-link"
				>
					{children}
				</a>
			);
		}

		return (
			<Link
				href={url}
				className="text-link_light underline underline-offset-4 dark:text-link"
			>
				{children}
			</Link>
		);
	},
	table: ({ children }) => (
		<div className="my-4 overflow-x-auto rounded-2xl border border-black/10 bg-white/70 first:mt-0 last:mb-0 dark:border-white/10 dark:bg-white/5">
			<table className="w-full min-w-[42rem] border-collapse text-sm !my-0">
				{children}
			</table>
		</div>
	),
	thead: ({ children }) => (
		<thead className="bg-black/5 dark:bg-white/5">{children}</thead>
	),
	th: ({ children }) => (
		<th className="px-4 py-2.5 text-left font-semibold text-black dark:text-white">
			{children}
		</th>
	),
	td: ({ children }) => (
		<td className="border-t border-black/10 px-4 py-2.5 align-top text-black/70 dark:border-white/10 dark:text-white/70">
			{children}
		</td>
	),
};

export default function PolicyPage({
	content,
	otherPolicyLink,
	homeLabel,
	className,
}: {
	content: string;
	otherPolicyLink: {
		href: "/privacy" | "/cookie-policy";
		label: string;
	};
	homeLabel: string;
	className?: string;
}) {
	return (
		<main
			id="main-content"
			className="scroll-mt-0 min-h-screen w-full max-w-[96rem] overflow-hidden p-4 focus:outline-none lg:p-8 xl:p-14"
		>
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<div className="flex flex-wrap items-center gap-3 text-sm">
					<Link
						href="/"
						className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-black/75 shadow-sm transition-colors hover:bg-white dark:border-white/10 dark:bg-white/8 dark:text-white/80 dark:hover:bg-white/14"
					>
						{homeLabel}
					</Link>
					<Link
						href={otherPolicyLink.href}
						className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-black/75 shadow-sm transition-colors hover:bg-white dark:border-white/10 dark:bg-white/8 dark:text-white/80 dark:hover:bg-white/14"
					>
						{otherPolicyLink.label}
					</Link>
				</div>
				<section className="rounded-[2rem] border border-black/10 bg-white/80 px-6 py-8 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-secondary/80 sm:px-8 lg:px-12 lg:py-12">
					<article
						className={twMerge(
							"prose prose-slate max-w-none prose-headings:scroll-mt-28 prose-headings:font-semibold prose-headings:text-black prose-a:no-underline prose-strong:text-black prose-th:border-none prose-td:border-none dark:prose-invert dark:prose-headings:text-white dark:prose-strong:text-white",
							className,
						)}
					>
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							components={markdownComponents}
						>
							{content}
						</ReactMarkdown>
					</article>
				</section>
			</div>
		</main>
	);
}
