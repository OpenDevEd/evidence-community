"use client";

// Local-only policy layout studies. Switch with ?variant=1 through 5.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { parseAsInteger, useQueryState } from "nuqs";
import { useTheme } from "next-themes";
import { Accordion, AccordionItem, ScrollShadow, SelectItem, Tooltip } from "@nextui-org/react";
import { ArrowLeft01Icon, ArrowRight01Icon, ArrowDown01Icon, BookOpen01Icon, Calendar01Icon, File02Icon, Layers01Icon, Mail01Icon, Moon02Icon, PrinterIcon, Shield01Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Select } from "@/components/nextui/Select";
import { Link } from "@/i18n/routing";
import styles from "./PolicyDesignMocks.module.css";

type Section = { id: string; title: string; body: ReactNode };
type Props = {
	title: string; description: string; updated: string; contactEmail?: string;
	otherPolicyLink: { href: string; label: string }; intro: ReactNode; sections: Section[];
};
const designs = ["Open article", "Chapter reader", "Expandable sections", "Split page", "Document sheet"];

function Icon({ icon, className = "" }: { icon: typeof File02Icon; className?: string }) {
	return <HugeiconsIcon icon={icon} size={20} className={`shrink-0 ${className}`} />;
}
function Updated({ date }: { date: string }) {
	return <div className={styles.updated}><Icon icon={Calendar01Icon} /><span>Updated</span><time>{date}</time></div>;
}
function Contact({ email, compact = false }: { email?: string; compact?: boolean }) {
	return email ? <a className={styles.contact} href={`mailto:${email}`} title={email}><Icon icon={Mail01Icon} /><span>{compact ? "Contact" : email}</span><Icon icon={ArrowRight01Icon} /></a> : null;
}
function DocumentLinks({ otherPolicyLink, title }: Pick<Props, "otherPolicyLink" | "title">) {
	const search = useSearchParams();
	const suffix = `?variant=${search.get("variant") || "1"}`;
	return <nav className={styles.documentLinks} aria-label="Policy documents">
		<span className={styles.currentDocument}><Icon icon={title.toLowerCase().includes("privacy") ? Shield01Icon : File02Icon} />{title}</span>
		<Button as={Link} href={`${otherPolicyLink.href}${suffix}`} variant="muted" size="xs" endContent={<Icon icon={ArrowRight01Icon} />}>{otherPolicyLink.label}</Button>
	</nav>;
}
function Contents({ sections }: { sections: Section[] }) {
	return <nav className={styles.contents} aria-label="Policy sections">
		<h2><Icon icon={BookOpen01Icon} />Contents</h2>
		{sections.map((section, i) => <a href={`#${section.id}`} key={section.id}><span className={styles.index}>{String(i + 1).padStart(2, "0")}</span><span>{section.title}</span></a>)}
	</nav>;
}
function Chapter({ section, index, numbered = false }: { section: Section; index: number; numbered?: boolean }) {
	return <section id={section.id} className={styles.chapter} tabIndex={-1}>
		{numbered && <span className={styles.chapterNumber}>{String(index + 1).padStart(2, "0")}</span>}
		<div className={styles.chapterBody}><h2>{section.title}</h2><div className={styles.markdown}>{section.body}</div></div>
	</section>;
}
function OpenArticle(props: Props) {
	return <div className={styles.openArticle}>
		<DocumentLinks {...props} />
		<header className={styles.openHeader}><h1>{props.title}</h1><p>{props.description}</p><Updated date={props.updated} /></header>
		<div className={styles.articleColumns}>
			<article>{props.intro && <div className={`${styles.markdown} ${styles.intro}`}>{props.intro}</div>}{props.sections.map((section, i) => <Chapter key={section.id} section={section} index={i} />)}</article>
			<aside><Contents sections={props.sections} /><Contact email={props.contactEmail} /></aside>
		</div>
	</div>;
}
function ChapterReader(props: Props) {
	const [selected, setSelected] = useState(Math.min(2, props.sections.length));
	const chapters = [{ id: "overview", title: "Overview", body: props.intro }, ...props.sections];
	const current = chapters[selected] ?? chapters[0];
	function select(index: number) { setSelected(index); document.getElementById("reader-title")?.focus({ preventScroll: true }); }
	return <div className={styles.reader}>
		<DocumentLinks {...props} />
		<div className={styles.readerFrame}>
			<aside className={styles.readerSidebar}>
				<div className={styles.readerIdentity}><Icon icon={BookOpen01Icon} /><h1>{props.title}</h1><Updated date={props.updated} /></div>
				<div className={styles.mobileChapterSelect}><Select aria-label="Policy chapter" color="filled" placement="left" selectedKeys={[String(selected)]} onSelectionChange={keys => { const key = Array.from(keys)[0]; if (key !== undefined) select(Number(key)); }} classNames={{base:"!max-w-none",value:"!text-left !text-sm"}}>{chapters.map((section, i) => <SelectItem key={String(i)}>{section.title}</SelectItem>)}</Select></div>
				<nav aria-label="Policy chapters">{chapters.map((section, i) => <button key={section.id} onClick={() => select(i)} aria-current={selected === i ? "page" : undefined}><span className={styles.index}>{i === 0 ? <Icon icon={File02Icon} /> : String(i).padStart(2, "0")}</span><span>{section.title}</span>{selected === i && <Icon icon={ArrowRight01Icon} />}</button>)}</nav>
			</aside>
			<article className={styles.readerArticle}>
				<div className={styles.readerTop}><span>{selected + 1}<span className={styles.muted}> / {chapters.length}</span></span><Contact email={props.contactEmail} compact /></div>
				<h2 id="reader-title" tabIndex={-1}>{current.title}</h2>
				{selected === 0 && <p className={styles.readerDescription}>{props.description}</p>}
				<div className={styles.markdown}>{current.body}</div>
				<div className={styles.readerBottom}><Button variant="muted" size="md" isDisabled={selected === 0} onPress={() => select(selected - 1)} startContent={<Icon icon={ArrowLeft01Icon} />}>Previous</Button><Button variant="muted" size="md" isDisabled={selected === chapters.length - 1} onPress={() => select(selected + 1)} endContent={<Icon icon={ArrowRight01Icon} />}>Next section</Button></div>
			</article>
		</div>
	</div>;
}
function ExpandableSections(props: Props) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set(props.sections[0] ? [props.sections[0].id] : []));
	const allExpanded = expanded.size === props.sections.length;
	return <div className={styles.expandable}>
		<DocumentLinks {...props} />
		<div className={styles.expandableColumns}>
			<header><span className={styles.policySymbol}><Icon icon={Shield01Icon} /></span><h1>{props.title}</h1><p>{props.description}</p><Updated date={props.updated} />{props.intro && <div className={`${styles.markdown} ${styles.intro}`}>{props.intro}</div>}<Contact email={props.contactEmail} /></header>
			<div className={styles.accordionColumn}>
				<div className={styles.sectionTools}><h2>Read by topic</h2><Button variant="muted" size="xs" onPress={() => setExpanded(allExpanded ? new Set() : new Set(props.sections.map(s => s.id)))} startContent={<Icon icon={Layers01Icon} />}>{allExpanded ? "Collapse all" : "Expand all"}</Button></div>
				<Accordion selectionMode="multiple" selectedKeys={expanded} onSelectionChange={keys => setExpanded(new Set(keys === "all" ? props.sections.map(s => s.id) : Array.from(keys, String)))} showDivider={false} className={styles.accordion} itemClasses={{base:styles.accordionItem, trigger:styles.accordionTrigger, title:styles.accordionTitle, content:styles.accordionContent, indicator:"text-accent"}}>
					{props.sections.map((section, i) => <AccordionItem key={section.id} aria-label={section.title} title={section.title} startContent={<span className={styles.index}>{String(i + 1).padStart(2, "0")}</span>}><div className={styles.markdown}>{section.body}</div></AccordionItem>)}
				</Accordion>
			</div>
		</div>
	</div>;
}
function SplitPage(props: Props) {
	return <div className={styles.splitPage}>
		<div className={styles.splitIdentity}>
			<ScrollShadow className={styles.splitSticky} size={80} offset={1}>
				<DocumentLinks {...props} />
				<h1>{props.title}</h1>
				<p className={styles.splitDescription}>{props.description}</p>
				<Updated date={props.updated} />
				<Contents sections={props.sections} />
				<Contact email={props.contactEmail} />
			</ScrollShadow>
		</div>
		<article className={styles.splitArticle}>{props.intro && <div className={`${styles.markdown} ${styles.intro}`}>{props.intro}</div>}{props.sections.map((section, i) => <Chapter key={section.id} section={section} index={i} numbered />)}</article>
	</div>;
}
function DocumentSheet(props: Props) {
	return <div className={styles.documentSheet}>
		<div className={styles.sheetToolbar}><DocumentLinks {...props} /><Button variant="muted" size="xs" onPress={() => window.print()} startContent={<Icon icon={PrinterIcon} />}>Print</Button></div>
		<article className={styles.sheet}>
			<header className={styles.sheetHeader}><div><h1>{props.title}</h1><p>{props.description}</p></div><Icon icon={File02Icon} /></header>
			<div className={styles.sheetMeta}><Updated date={props.updated} /><Contact email={props.contactEmail} /></div>
			<details className={styles.sheetContents}><summary><Icon icon={BookOpen01Icon} />Browse sections<Icon icon={ArrowDown01Icon} /></summary><Contents sections={props.sections} /></details>
			{props.intro && <div className={`${styles.markdown} ${styles.intro}`}>{props.intro}</div>}
			{props.sections.map((section, i) => <Chapter key={section.id} section={section} index={i} numbered />)}
		</article>
	</div>;
}
export default function PolicyDesignMocks(props: Props) {
	const pathname = usePathname();
	const [raw, setVariant] = useQueryState("variant", parseAsInteger.withDefault(1).withOptions({ shallow: true, clearOnDefault: false }));
	const { resolvedTheme, setTheme } = useTheme();
	const variant = Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : 1;
	const choose = useCallback((next: number) => {
		void setVariant((next + 4) % 5 + 1);
		window.scrollTo({ top: 0, behavior: "instant" });
	}, [setVariant]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable],button,a,[role=tab]")) return;
			if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); choose(variant + (event.key === "ArrowRight" ? 1 : -1)); }
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [choose, variant]);
	const Design = [OpenArticle, ChapterReader, ExpandableSections, SplitPage, DocumentSheet][variant - 1];
	return <main id="main-content" className={styles.preview}>
		<Design key={`${pathname}-${variant}`} {...props} />
		<div className={styles.switcher} aria-label="Policy design preview">
			<Tooltip content="Previous design"><Button isIconOnly variant="muted" size="md" aria-label="Previous design" onPress={() => choose(variant - 1)}><Icon icon={ArrowLeft01Icon} /></Button></Tooltip>
			<div className={styles.designButtons}>{designs.map((name, i) => <Tooltip content={name} key={name}><Button isIconOnly variant="muted" size="md" aria-label={`Design ${i + 1}: ${name}`} aria-pressed={variant === i + 1} onPress={() => choose(i + 1)}>{i + 1}</Button></Tooltip>)}</div>
			<span className={styles.designName}><span>{variant} / 5</span><strong>{designs[variant - 1]}</strong></span>
			<Tooltip content="Next design"><Button isIconOnly variant="muted" size="md" aria-label="Next design" onPress={() => choose(variant + 1)}><Icon icon={ArrowRight01Icon} /></Button></Tooltip>
			<Tooltip content="Change theme"><Button isIconOnly variant="muted" size="md" aria-label="Change preview theme" onPress={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}><Icon icon={resolvedTheme === "dark" ? Sun03Icon : Moon02Icon} /></Button></Tooltip>
		</div>
	</main>;
}
