"use client";

import { ChevronRight, ScrollText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

export type PolicyTocSection = {
	id: string;
	level: 1 | 2 | 3;
	title: string;
};

export default function PolicyToc({
	sections,
}: {
	sections: PolicyTocSection[];
}) {
	const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
	const navRef = useRef<HTMLElement | null>(null);

	const sectionIds = useMemo(
		() => sections.map((section) => section.id),
		[sections],
	);

	useEffect(() => {
		if (!sections.length) {
			return;
		}

		const syncActiveFromHash = () => {
			const hash = window.location.hash.slice(1);

			if (hash && sectionIds.includes(hash)) {
				setActiveId(hash);
				return true;
			}

			return false;
		};

		if (!syncActiveFromHash()) {
			setActiveId(sections[0].id);
		}

		const headings = sectionIds
			.map((id) => document.getElementById(id))
			.filter((node): node is HTMLElement => Boolean(node));

		if (!headings.length) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				const visibleEntries = entries.filter(
					(entry) => entry.isIntersecting && entry.intersectionRatio > 0.15,
				);

				if (!visibleEntries.length) {
					return;
				}

				const mostVisible = visibleEntries.reduce((max, entry) =>
					entry.intersectionRatio > max.intersectionRatio ? entry : max,
				);

				setActiveId(mostVisible.target.id);
			},
			{
				root: null,
				rootMargin: "0px 0px -72% 0px",
				threshold: [0, 0.15, 0.3, 0.5, 0.75, 1],
			},
		);

		headings.forEach((heading) => observer.observe(heading));

		const handleHashChange = () => {
			syncActiveFromHash();
		};

		window.addEventListener("hashchange", handleHashChange);

		return () => {
			headings.forEach((heading) => observer.unobserve(heading));
			observer.disconnect();
			window.removeEventListener("hashchange", handleHashChange);
		};
	}, [sectionIds, sections]);

	useEffect(() => {
		if (!activeId || !navRef.current) {
			return;
		}

		const activeLink = navRef.current.querySelector<HTMLAnchorElement>(
			`a[href="#${CSS.escape(activeId)}"]`,
		);

		activeLink?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [activeId]);

	if (!sections.length) {
		return null;
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col rounded-[1.75rem] border border-black/10 bg-background_light/900 p-5 shadow-[0_20px_55px_-40px_rgba(0,0,0,0.35)] dark:border-white/10 dark:bg-card/78">
			<div className="mb-4 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-black/45 dark:text-white/45">
				<ScrollText className="size-4 text-accent" />
				On this page
			</div>

			<nav
				ref={navRef}
				aria-label="Policy sections"
				className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1"
			>
				{sections.map((section) => {
					const isActive = section.id === activeId;

					return (
						<a
							key={section.id}
							href={`#${section.id}`}
							aria-current={isActive ? "location" : undefined}
							onKeyDown={(event) => {
								if (event.key !== "Enter") {
									return;
								}

								window.requestAnimationFrame(() => {
									document.getElementById(section.id)?.focus();
								});
							}}
							className={twMerge(
								"group relative flex items-start gap-3 rounded-2xl border px-3 py-2.5 text-sm leading-6 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
								isActive
									? "border-accent/20 bg-accent/8 text-black shadow-[0_10px_24px_-20px_rgba(0,0,0,0.45)] dark:border-accent/20 dark:bg-accent/12 dark:text-white"
									: "border-transparent text-black/68 hover:border-black/8 hover:bg-black/[0.03] hover:text-black dark:text-white/68 dark:hover:border-white/10 dark:hover:bg-white/[0.05] dark:hover:text-white",
								section.level > 1 ? "ml-3" : "",
								section.level > 2 ? "ml-6 text-[0.82rem]" : "",
							)}
						>
							<span
								className={twMerge(
									"mt-1.5 size-1.5 shrink-0 rounded-full transition-all",
									isActive
										? "bg-accent shadow-[0_0_0_4px_rgba(230,129,36,0.14)]"
										: "bg-black/18 group-hover:bg-accent dark:bg-white/18 dark:group-hover:bg-accent",
								)}
							/>
							<span className="min-w-0 flex-1">{section.title}</span>
							<ChevronRight
								className={twMerge(
									"mt-1 size-4 shrink-0 transition-transform",
									isActive
										? "translate-x-0 text-accent"
										: "translate-x-0 text-black/25 group-hover:translate-x-0.5 group-hover:text-accent dark:text-white/25",
								)}
							/>
						</a>
					);
				})}
			</nav>
		</div>
	);
}
