"use client";

import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	type ReactNode,
	type RefObject,
} from "react";
import { useTranslations } from "next-intl";
import { ScrollShadow } from "@nextui-org/react";
import {
	ArrowRight01Icon,
	BookOpen01Icon,
	Calendar01Icon,
	File02Icon,
	Mail01Icon,
	Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Skeleton } from "@/components/nextui/Skeleton";
import PolicyEmailCopyButton from "./PolicyEmailCopyButton";
import { useScrollSpy } from "@/hooks/useScrollSpy";
import { Link } from "@/i18n/routing";
import styles from "./PolicyLayout.module.css";

type Section = { id: string; title: string; body: ReactNode };
type Props = {
	title: string;
	description: string;
	updated: string;
	updatedISO: string;
	contactEmail?: string;
	otherPolicyLink: { href: string; label: string };
	intro: ReactNode;
	sections: Section[];
};
function Icon({
	icon,
	className = "",
}: {
	icon: typeof File02Icon;
	className?: string;
}) {
	return (
		<HugeiconsIcon
			icon={icon}
			size={20}
			className={`shrink-0 ${className}`}
		/>
	);
}
function Updated({ date, dateTime }: { date: string; dateTime: string }) {
	const t = useTranslations("policy");
	return (
		<div className={styles.updated}>
			<Icon icon={Calendar01Icon} />
			<span>{t("updated")}</span>
			<time dateTime={dateTime}>{date}</time>
		</div>
	);
}
function Contact({ email }: { email?: string }) {
	return email ? (
		<div className={styles.contact}>
			<a href={`mailto:${email}`}>
				<Icon icon={Mail01Icon} />
				<span>{email}</span>
			</a>
			<PolicyEmailCopyButton email={email} />
		</div>
	) : null;
}
function DocumentLinks({
	otherPolicyLink,
	title,
}: Pick<Props, "otherPolicyLink" | "title">) {
	const t = useTranslations("policy");
	return (
		<nav className={styles.documentLinks} aria-label={t("documents")}>
			<span className={styles.currentDocument}>
				<Icon
					icon={
						title.toLowerCase().includes("privacy")
							? Shield01Icon
							: File02Icon
					}
				/>
				{title}
			</span>
			<Button
				as={Link}
				href={otherPolicyLink.href}
				variant="muted"
				size="xs"
				endContent={<Icon icon={ArrowRight01Icon} />}
			>
				{otherPolicyLink.label}
			</Button>
		</nav>
	);
}
function keepLinkVisible(container: HTMLDivElement, link: Element) {
	const bounds = container.getBoundingClientRect();
	const row = link.getBoundingClientRect();
	const style = getComputedStyle(container);
	const inset =
		Number.parseFloat(style.getPropertyValue("--scroll-shadow-size")) || 16;
	const topInset = Math.max(
		inset,
		Number.parseFloat(style.scrollPaddingTop) || 0,
	);
	const delta =
		row.top < bounds.top + topInset
			? row.top - bounds.top - topInset
			: row.bottom > bounds.bottom - inset
				? row.bottom - bounds.bottom + inset
				: 0;
	if (delta) container.scrollBy({ top: delta, behavior: "auto" });
}
function sidebarNavbarState(container: HTMLDivElement | null) {
	if (!container || getComputedStyle(container).overflowY !== "auto")
		return null;
	const navbar = document.getElementById("site-header");
	if (!navbar) return null;
	return {
		container,
		pastNavbar: navbar.getBoundingClientRect().bottom <= 0,
		atTop: window.scrollY <= 1,
	};
}
function Contents({
	sections,
	scrollContainer,
}: {
	sections: Section[];
	scrollContainer: RefObject<HTMLDivElement | null>;
}) {
	const t = useTranslations("policy");
	const ids = useMemo(
		() => sections.map((section) => section.id),
		[sections],
	);
	const navRef = useRef<HTMLElement>(null);
	const scrollState = useRef({ pastNavbar: false, atTop: true });
	function syncNavbar() {
		const position = sidebarNavbarState(scrollContainer.current);
		if (!position) return;
		const { container, pastNavbar, atTop } = position;
		const previous = scrollState.current;
		scrollState.current = { pastNavbar, atTop };
		if (
			(atTop && !previous.atTop) ||
			(!pastNavbar && previous.pastNavbar)
		) {
			container.removeAttribute("data-navbar-away");
			container.scrollTo({ top: 0, behavior: "auto" });
		} else if (
			pastNavbar &&
			!previous.pastNavbar &&
			container.scrollTop <= 1
		) {
			container.setAttribute("data-navbar-away", "true");
		}
	}
	const { active, jumpTo } = useScrollSpy(ids, syncNavbar);
	useEffect(() => {
		const container = scrollContainer.current;
		const link = navRef.current?.querySelector('[aria-current="location"]');
		if (
			!container ||
			!link ||
			container.scrollHeight <= container.clientHeight
		)
			return;
		const style = getComputedStyle(container);
		// Returning to the navbar takes precedence over following a section link.
		if (
			window.scrollY <=
			(Number.parseFloat(
				style.getPropertyValue("--policy-header-space"),
			) || 0)
		)
			return;
		if (active === ids.at(-1)) {
			container.scrollTo({
				top: container.scrollHeight,
				behavior: "auto",
			});
			return;
		}
		keepLinkVisible(container, link);
	}, [active, ids, scrollContainer]);
	return (
		<nav
			ref={navRef}
			className={styles.contents}
			aria-label={t("sections")}
		>
			<h2>
				<Icon icon={BookOpen01Icon} />
				{t("contents")}
			</h2>
			{sections.map((section, i) => (
				<a
					href={`#${section.id}`}
					key={section.id}
					aria-current={
						active === section.id ? "location" : undefined
					}
					onClick={(event) => {
						if (
							event.metaKey ||
							event.ctrlKey ||
							event.shiftKey ||
							event.altKey
						)
							return;
						event.preventDefault();
						window.history.pushState(null, "", `#${section.id}`);
						jumpTo(section.id);
					}}
				>
					<span className={styles.index} aria-hidden="true">
						{String(i + 1).padStart(2, "0")}
					</span>
					<span>{section.title}</span>
				</a>
			))}
		</nav>
	);
}
function Chapter({ section, index }: { section: Section; index: number }) {
	return (
		<section id={section.id} className={styles.chapter} tabIndex={-1}>
			<span className={styles.chapterNumber} aria-hidden="true">
				{String(index + 1).padStart(2, "0")}
			</span>
			<div className={styles.chapterBody}>
				<h2>{section.title}</h2>
				<div className={styles.markdown}>{section.body}</div>
			</div>
		</section>
	);
}
export default function PolicyLayout(props: Props) {
	const sidebarRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const sidebar = sidebarRef.current;
		if (!sidebar) return;
		const measure = () => {
			const page = sidebar.parentElement;
			if (!page) return;
			const headerSpace =
				page.getBoundingClientRect().top + window.scrollY;
			const padding = parseFloat(
				getComputedStyle(sidebar).getPropertyValue(
					"--policy-content-gap",
				),
			);
			page.style.setProperty("--policy-header-space", `${headerSpace}px`);
			page.style.setProperty(
				"--policy-panel-clearance",
				`${headerSpace + padding}px`,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(document.body);
		observer.observe(sidebar);
		return () => observer.disconnect();
	}, []);
	return (
		<main id="main-content" className={styles.page}>
			<div className={styles.splitPage}>
				<div ref={sidebarRef} className={styles.splitIdentity}>
					<ScrollShadow
						ref={scrollRef}
						className={styles.splitSticky}
						size={80}
						offset={1}
					>
						<DocumentLinks {...props} />
						<h1>{props.title}</h1>
						<p className={styles.splitDescription}>
							{props.description}
						</p>
						<Updated
							date={props.updated}
							dateTime={props.updatedISO}
						/>
						{props.sections.length > 0 && (
							<Contents
								sections={props.sections}
								scrollContainer={scrollRef}
							/>
						)}
						<Contact email={props.contactEmail} />
					</ScrollShadow>
				</div>
				<article className={styles.splitArticle}>
					{props.intro && (
						<div className={`${styles.markdown} ${styles.intro}`}>
							{props.intro}
						</div>
					)}
					{props.sections.map((section, i) => (
						<Chapter key={section.id} section={section} index={i} />
					))}
				</article>
			</div>
		</main>
	);
}

/** Widths of the placeholder lines, so they read as paragraphs. */
const PLACEHOLDER_LINES = ["96%", "100%", "92%", "64%", "", "100%", "88%", "97%", "72%", "", "94%", "100%", "58%"];

/**
 * The page's two columns while its document is read: the heading it already knows, and placeholders where the date,
 * the other policy's link, the contents and the text go.
 */
export function PolicyLayoutPlaceholder({ page }: { page: "privacy" | "terms" | "cookie" }) {
	const t = useTranslations("policyPages");
	const title = t(`${page}.title`);
	const description = t(`${page}.description`);
	return (
		<main id="main-content" className={styles.page} aria-busy="true">
			<div className={styles.splitPage}>
				<div className={styles.splitIdentity}>
					<div className={styles.splitSticky}>
						<div className={styles.documentLinks}>
							<span className={styles.currentDocument}>
								<Icon icon={title.toLowerCase().includes("privacy") ? Shield01Icon : File02Icon} />
								{title}
							</span>
							<Skeleton className="h-6 w-28 rounded-lg" />
						</div>
						<h1>{title}</h1>
						<p className={styles.splitDescription}>{description}</p>
						<Skeleton className="h-5 w-44 rounded-md" />
					</div>
				</div>
				<article className={styles.splitArticle}>
					<div className="flex flex-col gap-3">
						{PLACEHOLDER_LINES.map((width, index) =>
							width ? <Skeleton key={index} className="h-4 rounded-md" style={{ width }} /> : <span key={index} className="h-3" />,
						)}
					</div>
				</article>
			</div>
		</main>
	);
}
