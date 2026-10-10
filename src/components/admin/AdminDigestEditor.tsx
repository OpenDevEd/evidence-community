"use client";

// MOCK: the digest's text as an editor writes it. Headings, bold and citations look as they will on the page:
// a citation is a chip, not a link written out. It reads and writes the same Markdown the digest is stored in.
import Link from "@tiptap/extension-link";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, getMarkRange, MarkViewContent, ReactMarkViewRenderer, useEditor, useEditorState, type Editor, type MarkViewRendererProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Popover, PopoverContent, PopoverTrigger, type InputProps } from "@nextui-org/react";
import { BookOpen01Icon, Calendar03Icon, Delete02Icon, Heading02Icon, LinkSquare02Icon, QuoteUpIcon, Search01Icon, Sorting05Icon, TextBoldIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { InlineCitationCard, InlineCitationCardBody, InlineCitationCardTrigger, InlineCitationSource } from "@/components/ai-elements/InlineCitation";
import { MOCK_PAPERS, type MockPaper } from "@/components/digests/mockEditorial";
import { PublicationLinkPreview } from "@/components/features/markdown/Citation";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { Input } from "@/components/nextui/Input";
import { Pagination } from "@/components/nextui/Pagination";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Tooltip } from "@/components/nextui/Tooltip";

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
const cite = (paper: MockPaper) => ({ type: "text", text: paper.label, marks: [{ type: "link", attrs: { href: `/lib/${paper.key}` } }] });
const citedIn = (editor: Editor) => new Set(Array.from(editor.getMarkdown().matchAll(/\]\(\/lib\/([A-Z0-9]{8})\)/g), (match) => match[1]));

const SORTS = {
	newest: { label: "Newest", order: (a: MockPaper, b: MockPaper) => b.date.localeCompare(a.date) },
	title: { label: "Title", order: (a: MockPaper, b: MockPaper) => a.title.localeCompare(b.title) },
	author: { label: "Author", order: (a: MockPaper, b: MockPaper) => a.label.localeCompare(b.label) },
};
type Sort = keyof typeof SORTS;
type Show = "all" | "reviews" | "uncited";
const PER_PAGE = 5;
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The edition's papers to cite from, a page at a time, searched, narrowed to reviews or to the ones the text leaves out, and sorted.
 * A row cites its paper; the button beside it opens the paper instead. On a chip it names that chip's paper and offers to take the citation out.
 */
function Papers({ cited, current, onPick, onRemove }: { cited: Set<string | undefined>; current?: string; onPick: (paper: MockPaper) => void; onRemove?: () => void }) {
	const [query, setQuery] = useState("");
	const [show, setShow] = useState<Show>("all");
	const [sort, setSort] = useState<Sort>("newest");
	const [page, setPage] = useState(1);
	const [active, setActive] = useState(0);
	const list = useId();
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	const found = MOCK_PAPERS.filter((paper) => words.every((word) => `${paper.label} ${paper.title}`.toLowerCase().includes(word)));
	const shown: Record<Show, MockPaper[]> = { all: found, reviews: found.filter((paper) => paper.review), uncited: found.filter((paper) => !cited.has(paper.key)) };
	const matches = shown[show].toSorted(SORTS[sort].order);
	const pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
	const rows = matches.slice((page - 1) * PER_PAGE, page * PER_PAGE);
	const using = MOCK_PAPERS.find((paper) => paper.key === current);
	const restart = () => { setPage(1); setActive(0); };
	const onKeyDown = (event: Parameters<NonNullable<InputProps["onKeyDown"]>>[0]) => {
		// React Aria input handlers stop propagation unless explicitly continued.
		if (event.key === "Escape") return event.continuePropagation();
		if (event.nativeEvent.isComposing || !rows.length) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setActive(Math.max(0, Math.min(rows.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
		} else if (event.key === "Enter") {
			event.preventDefault();
			onPick(rows[active]!);
		}
	};
	const filter = (key: Show, label: string) =>
		<button type="button" aria-pressed={show === key} onClick={() => { setShow(key); restart(); }} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${show === key ? "bg-white text-black shadow-sm dark:bg-white/10 dark:text-white" : `${muted} hover:text-black/80 dark:hover:text-white/80`}`}>
			{label}<span className="tabular-nums opacity-60">{shown[key].length}</span>
		</button>;
	return <>
		{using && <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] py-2 pl-4 pr-2 dark:border-white/[0.08]">
			<span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{using.title}</span><span className={`block truncate text-xs ${muted}`}>{using.label}</span></span>
			<button type="button" onClick={onRemove} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-red-700 hover:bg-red-500/10 dark:text-red-300">
				<HugeiconsIcon icon={Delete02Icon} aria-hidden size={14} />Remove citation
			</button>
		</div>}
		<div className="shrink-0 space-y-2 p-2">
			<Input
				autoFocus size="sm" role="combobox" aria-label="Search this edition's papers" placeholder="Search this edition's papers" aria-expanded aria-autocomplete="list" aria-controls={list}
				aria-activedescendant={rows[active] ? `${list}-${rows[active].key}` : undefined}
				value={query} onValueChange={(value) => { setQuery(value); restart(); }} onKeyDown={onKeyDown}
				startContent={<HugeiconsIcon icon={Search01Icon} className="size-4 shrink-0 text-black/40 dark:text-white/40" />}
				classNames={{ inputWrapper: "h-9 min-h-9 rounded-lg border-0 bg-black/[0.035] shadow-none dark:bg-white/[0.045]", input: "text-sm" }}
			/>
			<div className="flex items-center justify-between gap-2">
				<div className="flex rounded-lg bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">{filter("all", "All")}{filter("reviews", "Reviews")}{filter("uncited", "Not in the text")}</div>
				<Select
					aria-label="Sort papers" size="sm" className="w-32" classNames={{ trigger: "h-8 min-h-8 rounded-lg", value: "text-xs" }}
					startContent={<HugeiconsIcon icon={Sorting05Icon} aria-hidden size={14} className={`shrink-0 ${muted}`} />}
					selectedKeys={new Set([sort])} disallowEmptySelection
					onSelectionChange={(keys) => { const next = [...keys][0] as Sort | undefined; if (next) { setSort(next); restart(); } }}
				>
					{(Object.keys(SORTS) as Sort[]).map((key) => <SelectItem key={key} classNames={{ title: "text-[13px]" }}>{SORTS[key].label}</SelectItem>)}
				</Select>
			</div>
		</div>
		{/* Five rows of one height, whatever matches, so nothing moves while the editor types or turns the page. */}
		<ul role="listbox" id={list} aria-label="Papers in this edition" className="h-[17.5rem] shrink-0 px-1">
			{rows.map((paper, index) => <li key={paper.key} role="presentation" onPointerMove={() => setActive(index)} className={`flex h-14 items-center gap-1 rounded-lg pr-1.5 ${index === active ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""}`}>
				<button
					type="button" role="option" id={`${list}-${paper.key}`} aria-selected={paper.key === current} tabIndex={-1}
					onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(paper)} className="h-full min-w-0 flex-1 rounded-lg pl-3 text-left"
				>
					<span className="block truncate text-[13px] font-medium leading-5">{paper.title}</span>
					<span className={`flex items-center gap-3 text-xs ${muted}`}>
						<span className="truncate">{paper.label}</span>
						<span className="inline-flex shrink-0 items-center gap-1 tabular-nums"><HugeiconsIcon icon={Calendar03Icon} aria-hidden size={12} />{day.format(new Date(paper.date))}</span>
						{paper.review && <span className="inline-flex shrink-0 items-center gap-1"><HugeiconsIcon icon={BookOpen01Icon} aria-hidden size={12} />Review</span>}
						{paper.key === current
							? <span className="inline-flex shrink-0 items-center gap-1 font-medium text-accent"><HugeiconsIcon icon={Tick01Icon} aria-hidden size={12} />Cited here</span>
							: cited.has(paper.key) && <span className="inline-flex shrink-0 items-center gap-1"><HugeiconsIcon icon={QuoteUpIcon} aria-hidden size={12} />In the text</span>}
					</span>
				</button>
				<Tooltip content="Open the paper">
					<a href={`/lib/${paper.key}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${paper.title}`} className={`grid size-8 shrink-0 place-items-center rounded-lg hover:bg-black/[0.06] hover:text-black dark:hover:bg-white/10 dark:hover:text-white ${muted}`}>
						<HugeiconsIcon icon={LinkSquare02Icon} aria-hidden size={15} />
					</a>
				</Tooltip>
			</li>)}
			{!rows.length && <li role="status" className={`px-3 py-2 text-sm ${muted}`}>No paper in this edition matches</li>}
		</ul>
		<div className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-black/[0.06] pl-4 pr-2 dark:border-white/[0.08]">
			<span className={`text-xs tabular-nums ${muted}`}>{matches.length ? `${(page - 1) * PER_PAGE + 1} to ${Math.min(page * PER_PAGE, matches.length)} of ${matches.length}` : "None"}</span>
			<Pagination aria-label="Pages of papers" size="sm" showControls siblings={0} total={pages} page={page} onChange={(next) => { setPage(next); setActive(0); }} />
		</div>
	</>;
}

/** A citation in the text. Resting on it shows the paper, as it does for readers. Clicking it changes the paper or takes the citation out. */
function Chip({ editor, mark }: MarkViewRendererProps) {
	const chip = useRef<HTMLSpanElement>(null);
	const [resting, setResting] = useState(false);
	const [picking, setPicking] = useState(false);
	const itemKey = CITE.exec(String(mark.attrs.href ?? ""))?.[1];
	// The digest's writer makes no other kind of link; one an editor pastes in stays as text.
	if (!itemKey) return <MarkViewContent />;
	const range = () => chip.current && getMarkRange(editor.state.doc.resolve(editor.view.posAtDOM(chip.current, 0)), mark.type, mark.attrs);
	// The card closes before its chip changes or goes, or it would be left hanging from nothing.
	const settle = () => { setResting(false); setPicking(false); };
	const replace = (paper: MockPaper) => {
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
	return <InlineCitationCard open={resting && !picking} onOpenChange={setResting}>
		<Popover isOpen={picking} onOpenChange={(open) => { setResting(false); setPicking(open); }} placement="bottom-start" shouldCloseOnScroll={false}>
			<PopoverTrigger>
				<InlineCitationCardTrigger>
					<span ref={chip} className={`${CHIP} cursor-pointer transition-colors hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus aria-expanded:bg-accent/20 dark:hover:bg-accent/30`}><MarkViewContent /></span>
				</InlineCitationCardTrigger>
			</PopoverTrigger>
			<PopoverContent aria-label="Change this citation" className={MENU}>{picking && <Papers cited={citedIn(editor)} current={itemKey} onPick={replace} onRemove={remove} />}</PopoverContent>
		</Popover>
		<InlineCitationCardBody className="w-96 max-w-[calc(100vw-1.5rem)]">
			<InlineCitationSource><PublicationLinkPreview itemKey={itemKey} href={`/lib/${itemKey}`} /></InlineCitationSource>
		</InlineCitationCardBody>
	</InlineCitationCard>;
}

const Citation = Link.extend({ addMarkView() { return ReactMarkViewRenderer(Chip); } });

function CiteTool({ editor }: { editor: Editor }) {
	const [open, setOpen] = useState(false);
	const insert = (paper: MockPaper) => {
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
		<PopoverContent aria-label="Cite a paper" className={MENU}>{open && <Papers cited={citedIn(editor)} onPick={insert} />}</PopoverContent>
	</Popover>;
}

export function AdminDigestEditor({ markdown, onChange, tools }: { markdown: string; onChange: (markdown: string) => void; /** Where the formatting buttons go: the pane's own bar, so nothing floats over the text. */ tools: HTMLElement | null }) {
	const editor = useEditor({
		extensions: [StarterKit.configure({ link: false }), Citation.configure({ openOnClick: false, autolink: false }), Markdown],
		content: markdown,
		contentType: "markdown",
		// The page renders on the server first, where there is no editor.
		immediatelyRender: false,
		editorProps: { attributes: { class: TEXT, "aria-label": "Digest text" } },
		onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
	});
	const on = useEditorState({ editor, selector: ({ editor: current }) => ({ heading: current?.isActive("heading", { level: 2 }) ?? false, bold: current?.isActive("bold") ?? false }) });
	const tool = (label: string, icon: IconSvgElement, pressed: boolean, run: () => void) =>
		<button type="button" aria-label={label} aria-pressed={pressed} onClick={run} className={`grid size-8 place-items-center rounded-lg transition-colors ${pressed ? "bg-black/[0.08] text-black dark:bg-white/15 dark:text-white" : "text-black/50 hover:bg-black/[0.05] hover:text-black/80 dark:text-white/50 dark:hover:bg-white/[0.08]"}`}>
			<HugeiconsIcon icon={icon} aria-hidden size={16} />
		</button>;
	return <>
		{tools && editor && createPortal(<>
			{tool("Heading", Heading02Icon, on?.heading ?? false, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
			{tool("Bold", TextBoldIcon, on?.bold ?? false, () => editor.chain().focus().toggleBold().run())}
			<CiteTool editor={editor} />
		</>, tools)}
		<EditorContent editor={editor} />
	</>;
}
