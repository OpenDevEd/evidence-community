"use client";

// The digest's text as an editor writes it. Headings, bold and citations look as they will on the page: a citation is
// a chip, not a link written out. It reads and writes the same Markdown the digest is stored in, and holds only what
// a digest may hold: second-level headings, paragraphs, bold and citations.
import Link from "@tiptap/extension-link";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, getMarkRange, MarkViewContent, ReactMarkViewRenderer, useEditor, useEditorState, type Editor, type MarkViewRendererProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Popover, PopoverContent, PopoverTrigger, type InputProps } from "@nextui-org/react";
import { BookOpen01Icon, Calendar03Icon, Delete02Icon, Heading02Icon, LinkSquare02Icon, QuoteUpIcon, Search01Icon, Sorting05Icon, TextBoldIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { createContext, useContext, useDeferredValue, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";

import { InlineCitationCard, InlineCitationCardBody, InlineCitationCardTrigger, InlineCitationSource } from "@/components/ai-elements/InlineCitation";
import { PublicationLinkPreview } from "@/components/features/markdown/Citation";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { Input } from "@/components/nextui/Input";
import { Pagination } from "@/components/nextui/Pagination";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Tooltip } from "@/components/nextui/Tooltip";
import type { DigestPaper, DigestPapersQuery } from "@/lib/notifications/editorial";
import { getAdminDigestCited, getAdminDigestPapers } from "./admin-api";

const TEXT = [
	"min-h-[55vh] text-[15px] leading-7 outline-none",
	"[&_h2:first-child]:mt-0 [&_h2]:mb-3 [&_h2]:mt-9 [&_h2]:border-b [&_h2]:border-black/15 [&_h2]:pb-1.5 [&_h2]:text-xl [&_h2]:font-semibold dark:[&_h2]:border-white/15",
	"[&_p]:mb-4 [&_strong]:font-semibold",
].join(" ");
/** A citation as the editor and the Changes view draw it. */
export const CHIP = "whitespace-nowrap rounded-md bg-accent/10 px-1.5 py-0.5 text-[13px] font-medium text-accent dark:bg-accent/20";
const MENU = "w-[30rem] max-w-[calc(100vw-2rem)] items-stretch overflow-hidden rounded-2xl border border-black/10 bg-white p-0 shadow-lg dark:border-white/10 dark:bg-secondary";
const muted = "text-black/50 dark:text-white/50";

const CITE = /^\/lib\/([A-Z0-9]{8})$/;
const cite = (paper: Pick<DigestPaper, "key" | "label">) => ({ type: "text", text: paper.label, marks: [{ type: "link", attrs: { href: `/lib/${paper.key}` } }] });
/** The records the text cites, in the order a reader meets them. */
const citedIn = (markdown: string) => [...new Set(Array.from(markdown.matchAll(/\]\(\/lib\/([A-Z0-9]{8})\)/g), (match) => match[1]!))];

/** The edition whose publications the picker offers, and the records its text cites now. Citation chips are drawn by the editor, out of reach of props. */
const Edition = createContext<{ id: string; cited: string[] }>({ id: "", cited: [] });

const SORTS: [DigestPapersQuery["sort"], string][] = [["newest", "Newest"], ["title", "Title"], ["author", "Author"]];
const SHOWS: [DigestPapersQuery["show"], string][] = [["all", "All"], ["reviews", "Reviews"], ["uncited", "Not in the text"]];
const ROWS = 5;
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A publication's date as its record gives it: a full date reads as a day, anything less is shown as it is. */
const dated = (date: string) => (/^\d{4}-\d{2}-\d{2}/.test(date) ? day.format(new Date(date.slice(0, 10))) : date);

const firstPage = (cited: string[]): DigestPapersQuery => ({ query: "", show: "all", sort: "newest", page: 1, cited });
/** A page of the edition's publications. The button that opens the picker reads its first page, so the list is there when it opens. */
function usePapers(editionId: string, query: DigestPapersQuery) {
	return useSWR(["admin-digest-papers", editionId, query] as const, ([, id, value]) => getAdminDigestPapers(id, value), { keepPreviousData: true, revalidateOnFocus: false });
}

/**
 * The page for what is typed in the search. `behind` is true while the rows on show still answer an earlier search or
 * page: Enter must not cite one of them.
 */
function useSearchedPapers(editionId: string, query: DigestPapersQuery, typed: string) {
	const search = useDeferredValue(typed);
	const list = usePapers(editionId, { ...query, query: search });
	return { ...list, behind: typed !== search || list.isLoading };
}

/** The publications the text cites, for naming a chip's own. Read with the picker's first page, before either is needed. */
function useCited(editionId: string, cited: string[]) {
	return useSWR(["admin-digest-cited", editionId, cited] as const, ([, id, keys]) => getAdminDigestCited(id, keys), { keepPreviousData: true, revalidateOnFocus: false });
}

type Current = { key: string; label: string };
type KeyEvent = Parameters<NonNullable<InputProps["onKeyDown"]>>[0];

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Enter: 0 };

/** The arrow keys move through the rows on the page and Enter cites the one they rest on. */
function rowKeys(rows: DigestPaper[], active: number, setActive: (index: number) => void, onPick: (paper: DigestPaper) => void) {
	return (event: KeyEvent) => {
		// React Aria input handlers stop propagation unless explicitly continued.
		if (event.key === "Escape") return event.continuePropagation();
		const step = STEPS[event.key];
		if (step === undefined || event.nativeEvent.isComposing || !rows.length) return;
		event.preventDefault();
		const rested = Math.max(0, Math.min(rows.length - 1, active + step));
		if (step === 0) onPick(rows[rested]!);
		else setActive(rested);
	};
}

/** How a row says where its publication stands with the text: cited by this chip, cited elsewhere, or not at all. */
function Standing({ paper, current, cited }: { paper: DigestPaper; current?: Current; cited: string[] }) {
	if (paper.key === current?.key) return <span className="inline-flex shrink-0 items-center gap-1 font-medium text-accent"><HugeiconsIcon icon={Tick01Icon} aria-hidden size={12} />Cited here</span>;
	if (!cited.includes(paper.key)) return null;
	return <span className="inline-flex shrink-0 items-center gap-1"><HugeiconsIcon icon={QuoteUpIcon} aria-hidden size={12} />In the text</span>;
}

/** One publication: the row cites it, and the button beside it opens it instead. */
function PaperRow({ id, paper, active, current, cited, onRest, onPick }: { id: string; paper: DigestPaper; active: boolean; current?: Current; cited: string[]; onRest: () => void; onPick: () => void }) {
	return <li role="presentation" onPointerMove={onRest} className={`flex h-14 items-center gap-1 rounded-lg pr-1.5 ${active ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""}`}>
		<button
			type="button" role="option" id={id} aria-selected={paper.key === current?.key} tabIndex={-1}
			onMouseDown={(event) => event.preventDefault()} onClick={onPick} className="h-full min-w-0 flex-1 rounded-lg pl-3 text-left"
		>
			<span className="block truncate text-[13px] font-medium leading-5">{paper.title}</span>
			<span className={`flex items-center gap-3 text-xs ${muted}`}>
				<span className="truncate">{paper.label}</span>
				{paper.date && <span className="inline-flex shrink-0 items-center gap-1 tabular-nums"><HugeiconsIcon icon={Calendar03Icon} aria-hidden size={12} />{dated(paper.date)}</span>}
				{paper.review && <span className="inline-flex shrink-0 items-center gap-1"><HugeiconsIcon icon={BookOpen01Icon} aria-hidden size={12} />Review</span>}
				<Standing paper={paper} current={current} cited={cited} />
			</span>
		</button>
		<Tooltip content="Open the publication">
			<a href={`/lib/${paper.key}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${paper.title}`} className={`grid size-8 shrink-0 place-items-center rounded-lg hover:bg-black/[0.06] hover:text-black dark:hover:bg-white/10 dark:hover:text-white ${muted}`}>
				<HugeiconsIcon icon={LinkSquare02Icon} aria-hidden size={15} />
			</a>
		</Tooltip>
	</li>;
}

/** Which of the edition's publications are listed, and in what order. */
function Narrow({ query, counts, onChange }: { query: DigestPapersQuery; counts: Record<DigestPapersQuery["show"], number> | undefined; onChange: (patch: Partial<DigestPapersQuery>) => void }) {
	return <div className="flex items-center justify-between gap-2">
		<div className="flex rounded-lg bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">
			{SHOWS.map(([show, label]) => <button key={show} type="button" aria-pressed={query.show === show} onClick={() => onChange({ show })} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${query.show === show ? "bg-white text-black shadow-sm dark:bg-white/10 dark:text-white" : `${muted} hover:text-black/80 dark:hover:text-white/80`}`}>
				{label}<span className="inline-block min-w-4 text-left tabular-nums opacity-60">{counts?.[show] ?? ""}</span>
			</button>)}
		</div>
		<Select
			aria-label="Sort publications" size="sm" className="w-32" classNames={{ trigger: "h-8 min-h-8 rounded-lg", value: "text-xs" }}
			startContent={<HugeiconsIcon icon={Sorting05Icon} aria-hidden size={14} className={`shrink-0 ${muted}`} />}
			selectedKeys={new Set([query.sort])} disallowEmptySelection
			onSelectionChange={(keys) => onChange({ sort: SORTS.find(([key]) => key === [...keys][0])?.[0] ?? "newest" })}
		>
			{SORTS.map(([key, label]) => <SelectItem key={key} classNames={{ title: "text-[13px]" }}>{label}</SelectItem>)}
		</Select>
	</div>;
}

const range = (page: number, total: number) => (total ? `${(page - 1) * ROWS + 1} to ${Math.min(page * ROWS, total)} of ${total}` : "None");

/** What the list says when it has no rows to show. */
function Empty({ loaded, failed }: { loaded: boolean; failed: boolean }) {
	if (loaded) return <li role="status" className={`px-3 py-2 text-sm ${muted}`}>No publication in this edition matches</li>;
	return failed ? <li role="alert" className={`px-3 py-2 text-sm ${muted}`}>The publications could not be read. Close this and try again.</li> : null;
}

/** The publication a chip cites, named above the list, with the way to take the citation out. */
function Cited({ current, cited, onRemove }: { current: Current; cited: string[]; onRemove?: () => void }) {
	const using = useCited(useContext(Edition).id, cited).data?.find((paper) => paper.key === current.key);
	return <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] py-2 pl-4 pr-2 dark:border-white/[0.08]">
		<span className="min-w-0 flex-1"><span className="block h-5 truncate text-[13px] font-medium">{using?.title}</span><span className={`block truncate text-xs ${muted}`}>{current.label}</span></span>
		<button type="button" onClick={onRemove} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-red-700 hover:bg-red-500/10 dark:text-red-300">
			<HugeiconsIcon icon={Delete02Icon} aria-hidden size={14} />Remove citation
		</button>
	</div>;
}

/** Where the list stands among its pages, and the way to the others. */
function Pages({ page, pages, total, onChange }: { page: number; pages: number; total: number | undefined; onChange: (page: number) => void }) {
	return <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-black/[0.06] pl-4 pr-2 dark:border-white/[0.08]">
		<span className={`text-xs tabular-nums ${muted}`}>{total !== undefined && range(page, total)}</span>
		<Pagination aria-label="Pages of publications" size="sm" showControls siblings={0} total={pages} page={page} onChange={onChange} />
	</div>;
}

type RowsProps = { id: string; /** Undefined before the first answer. */ rows: DigestPaper[] | undefined; failed: boolean; dimmed: boolean; active: number; setActive: (index: number) => void; current?: Current; cited: string[]; onPick: (paper: DigestPaper) => void };

/**
 * Five rows of one height, whatever matches, so nothing moves while the editor types or turns the page. Rows kept from
 * the page before are dimmed until the new ones arrive. Opened before its first page has arrived, the list shows its
 * rows' places, so they fill in where they stand.
 */
function Rows({ id, rows, failed, dimmed, active, setActive, current, cited, onPick }: RowsProps) {
	return <ul role="listbox" id={id} aria-label="Publications in this edition" className={`h-[17.5rem] shrink-0 px-1 transition-opacity ${dimmed ? "pointer-events-none opacity-50" : ""}`}>
		{rows?.map((paper, index) => <PaperRow key={paper.key} id={`${id}-${paper.key}`} paper={paper} active={index === active} current={current} cited={cited} onRest={() => setActive(index)} onPick={() => onPick(paper)} />)}
		{!rows && !failed && Array.from({ length: ROWS }, (_, index) => <li key={index} role="presentation" className="flex h-14 flex-col justify-center gap-2 px-3"><Skeleton className="h-3.5 w-4/5 rounded-md" /><Skeleton className="h-3 w-2/5 rounded-md" /></li>)}
		{!rows?.length && <Empty loaded={rows !== undefined} failed={failed} />}
	</ul>;
}

/**
 * The edition's publications to cite from, a page at a time: searched, narrowed to reviews or to those the text leaves
 * out, and sorted. A row cites its publication; the button beside it opens the publication instead. On a chip it names
 * that chip's publication and offers to take the citation out.
 */
function Papers({ cited, current, onPick, onRemove }: { cited: string[]; current?: Current; onPick: (paper: DigestPaper) => void; onRemove?: () => void }) {
	const { id: editionId } = useContext(Edition);
	const [typed, setTyped] = useState("");
	const [query, setQuery] = useState(firstPage(cited));
	const [active, setActive] = useState(0);
	const list = useId();
	const { data, error, isLoading, behind } = useSearchedPapers(editionId, { ...query, cited }, typed);
	// Before the first answer the list is empty and stands on its first page.
	const { papers: rows, page, pages } = data ?? { papers: [], page: 1, pages: 1 };
	const narrow = (patch: Partial<DigestPapersQuery>) => { setQuery({ ...query, page: 1, ...patch }); setActive(0); };
	return <>
		{current && <Cited current={current} cited={cited} onRemove={onRemove} />}
		<div className="shrink-0 space-y-2 p-2">
			<Input
				autoFocus size="sm" role="combobox" aria-label="Search this edition's publications" placeholder="Search this edition's publications" aria-expanded aria-autocomplete="list" aria-controls={list}
				aria-activedescendant={rows[active] ? `${list}-${rows[active].key}` : undefined}
				value={typed} onValueChange={(value) => { setTyped(value); narrow({}); }} onKeyDown={rowKeys(behind ? [] : rows, active, setActive, onPick)}
				startContent={<HugeiconsIcon icon={Search01Icon} className="size-4 shrink-0 text-black/40 dark:text-white/40" />}
				classNames={{ inputWrapper: "h-9 min-h-9 rounded-lg border-0 bg-black/[0.035] shadow-none dark:bg-white/[0.045]", input: "text-sm" }}
			/>
			<Narrow query={query} counts={data?.counts} onChange={narrow} />
		</div>
		<Rows id={list} rows={data?.papers} failed={error !== undefined} dimmed={isLoading && data !== undefined} active={active} setActive={setActive} current={current} cited={cited} onPick={onPick} />
		<Pages page={page} pages={pages} total={data?.total} onChange={(next) => { setQuery({ ...query, page: next }); setActive(0); }} />
	</>;
}

/** A citation in the text. Resting on it shows the publication, as it does for readers. Clicking it changes the publication or takes the citation out. */
function Chip({ editor, mark }: MarkViewRendererProps) {
	const chip = useRef<HTMLSpanElement>(null);
	const [resting, setResting] = useState(false);
	const { cited } = useContext(Edition);
	// The chip's own words, read when the picker opens.
	const [picking, setPicking] = useState<string | null>(null);
	const itemKey = CITE.exec(String(mark.attrs.href ?? ""))?.[1];
	// The digest's writer makes no other kind of link; one a person pastes in stays as text until the library refuses it.
	if (!itemKey) return <MarkViewContent />;
	const range = () => chip.current && getMarkRange(editor.state.doc.resolve(editor.view.posAtDOM(chip.current, 0)), mark.type, mark.attrs);
	// The card closes before its chip changes or goes, or it would be left hanging from nothing.
	const settle = () => { setResting(false); setPicking(null); };
	const replace = (paper: DigestPaper) => {
		const at = range();
		settle();
		if (at) editor.chain().focus().insertContentAt(at, cite(paper)).run();
	};
	const remove = () => {
		const at = range();
		settle();
		// The space before the chip goes with it.
		if (at) editor.chain().focus().deleteRange({ from: at.from > 1 && editor.state.doc.textBetween(at.from - 1, at.from) === " " ? at.from - 1 : at.from, to: at.to }).run();
	};
	return <InlineCitationCard open={resting && picking === null} onOpenChange={setResting}>
		<Popover isOpen={picking !== null} onOpenChange={(open) => { setResting(false); setPicking(open ? chip.current?.textContent ?? "" : null); }} placement="bottom-start" shouldCloseOnScroll={false}>
			<PopoverTrigger>
				<InlineCitationCardTrigger>
					<span ref={chip} data-citation tabIndex={0} role="button" aria-haspopup="dialog" onKeyDown={(event) => { if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); chip.current?.click(); } }} className={`${CHIP} cursor-pointer transition-colors hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus aria-expanded:bg-accent/20 dark:hover:bg-accent/30`}><MarkViewContent /></span>
				</InlineCitationCardTrigger>
			</PopoverTrigger>
			<PopoverContent aria-label="Change this citation" className={MENU}>{picking !== null && <Papers cited={cited} current={{ key: itemKey, label: picking }} onPick={replace} onRemove={remove} />}</PopoverContent>
		</Popover>
		<InlineCitationCardBody className="w-96 max-w-[calc(100vw-1.5rem)]">
			<InlineCitationSource><PublicationLinkPreview itemKey={itemKey} href={`/lib/${itemKey}`} /></InlineCitationSource>
		</InlineCitationCardBody>
	</InlineCitationCard>;
}

/**
 * The address of one of this library's records as a citation holds it, `/lib/KEY`. A browser's clipboard writes links
 * out in full, so a citation copied from this site arrives with the site's own address in front.
 */
function citationHref(href: string | null) {
	if (!href || CITE.test(href)) return href;
	try {
		const url = new URL(href, window.location.origin);
		return url.origin === window.location.origin && CITE.test(url.pathname) ? url.pathname : href;
	} catch {
		return href;
	}
}

const Citation = Link.extend({
	addMarkView() { return ReactMarkViewRenderer(Chip); },
	addAttributes() { return { ...this.parent?.(), href: { default: null, parseHTML: (element: HTMLElement) => citationHref(element.getAttribute("href")) } }; },
});

/**
 * A chip reached with Tab opens with Enter or Space, as a click does. In a browser the editor sees the key first and
 * would take it as text, so it is answered here; the chip's own handler covers the case where the editor passes it on.
 */
function chipKey(_view: unknown, event: KeyboardEvent) {
	const chip = event.target instanceof HTMLElement && event.target.matches("[data-citation]") ? event.target : null;
	if (!chip || (event.key !== "Enter" && event.key !== " ")) return false;
	event.preventDefault();
	chip.click();
	return true;
}


function CiteTool({ editor, editionId, cited }: { editor: Editor; editionId: string; cited: string[] }) {
	const [open, setOpen] = useState(false);
	// Read here, where the button is, so the first page is there when the picker opens.
	usePapers(editionId, firstPage(cited));
	useCited(editionId, cited);
	const insert = (paper: DigestPaper) => {
		const { from } = editor.state.selection;
		const spaced = from > 1 && /\S/.test(editor.state.doc.textBetween(from - 1, from, "\n"));
		editor.chain().focus().insertContent(spaced ? [{ type: "text", text: " " }, cite(paper)] : cite(paper)).run();
		setOpen(false);
	};
	return <Popover isOpen={open} onOpenChange={setOpen} placement="bottom-end" shouldCloseOnScroll={false}>
		<PopoverTrigger>
			<button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${open ? "bg-black/[0.08] text-black dark:bg-white/15 dark:text-white" : "text-black/50 hover:bg-black/[0.05] hover:text-black/80 dark:text-white/50 dark:hover:bg-white/[0.08]"}`}>
				<HugeiconsIcon icon={QuoteUpIcon} aria-hidden size={15} />Cite
			</button>
		</PopoverTrigger>
		<PopoverContent aria-label="Cite a publication" className={MENU}>{open && <Papers cited={cited} onPick={insert} />}</PopoverContent>
	</Popover>;
}

// A digest holds second-level headings, paragraphs, bold and citations, so the editor makes nothing else.
const KIT = StarterKit.configure({
	link: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, code: false, codeBlock: false,
	horizontalRule: false, italic: false, strike: false, underline: false, heading: { levels: [2] },
});

export function AdminDigestEditor({ editionId, markdown, onChange, tools }: { editionId: string; markdown: string; onChange: (markdown: string) => void; /** Where the formatting buttons go: the pane's own bar, so nothing floats over the text. */ tools: HTMLElement | null }) {
	const editor = useEditor({
		// Only a citation is a link here: a link to anywhere else, pasted in with its text, comes in as the text alone.
		extensions: [KIT, Citation.configure({ openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: (url) => CITE.test(citationHref(url) ?? "") }), Markdown],
		content: markdown,
		contentType: "markdown",
		// The page renders on the server first, where there is no editor.
		immediatelyRender: false,
		editorProps: { attributes: { class: TEXT, "aria-label": "Digest text" }, handleKeyDown: chipKey },
		onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
	});
	const on = useEditorState({ editor, selector: ({ editor: current }) => ({ heading: current?.isActive("heading", { level: 2 }) ?? false, bold: current?.isActive("bold") ?? false }) });
	// Read from the text in hand, not from the editor, so it is known on the first frame.
	const cited = citedIn(markdown);
	const tool = (label: string, icon: IconSvgElement, pressed: boolean, run: () => void) =>
		<Tooltip content={label}>
			<button type="button" aria-label={label} aria-pressed={pressed} onClick={run} className={`grid size-8 place-items-center rounded-lg transition-colors ${pressed ? "bg-black/[0.08] text-black dark:bg-white/15 dark:text-white" : "text-black/50 hover:bg-black/[0.05] hover:text-black/80 dark:text-white/50 dark:hover:bg-white/[0.08]"}`}>
				<HugeiconsIcon icon={icon} aria-hidden size={16} />
			</button>
		</Tooltip>;
	return <Edition value={{ id: editionId, cited }}>
		{tools && editor && createPortal(<>
			{tool("Heading", Heading02Icon, on?.heading ?? false, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
			{tool("Bold", TextBoldIcon, on?.bold ?? false, () => editor.chain().focus().toggleBold().run())}
			<CiteTool editor={editor} editionId={editionId} cited={cited} />
		</>, tools)}
		<EditorContent editor={editor} />
	</Edition>;
}
