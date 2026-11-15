"use client";

// Digests in the admin. AI writes each one. The library's team reads it, changes it and sends it for review, and an
// Editor or Owner publishes it under their own name. As with a record, readers see a change only once it is published.
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
	AiMagicIcon,
	Alert02Icon,
	ArrowLeft01Icon,
	ArrowTurnBackwardIcon,
	BookOpen01Icon,
	Calendar03Icon,
	CheckmarkBadge01Icon,
	FileClockIcon,
	GitCompareIcon,
	InboxIcon,
	MailSend01Icon,
	PauseIcon,
	PencilEdit02Icon,
	Refresh01Icon,
	SentIcon,
	Settings02Icon,
	Sorting05Icon,
	UserCheck01Icon,
	ViewIcon,
} from "@hugeicons/core-free-icons";

import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { Face } from "@/components/digests/DigestPrimitives";
import { AIMarkdown } from "@/components/features/markdown/Markdown";
import { CitedPublications } from "@/components/features/markdown/Citation";
import { Button } from "@/components/nextui/Button";
import { Pagination } from "@/components/nextui/Pagination";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Skeleton } from "@/components/nextui/Skeleton";
import { SortHeader } from "./AdminSortHeader";
import { AnimatePresence, motion } from "framer-motion";
import type { AdminDigestsQuery, DigestAction, DigestState } from "@/lib/notifications/editorial";
import { DIGEST_SIGNER_ROLE, type DigestEventKind, type DigestPerson, type DigestSigner } from "@/lib/notifications/types";
import { ADDED, ChangedLine, ChangedText, REMOVED } from "./AdminDigestChanges";
import { changesBetween, editCount } from "./digest-changes";
import { AdminDigestEditor } from "./AdminDigestEditor";
import { getAdminDigest, getAdminDigests, type AdminDigest, type AdminDigestList } from "./admin-api";
import { useAdminLive } from "./admin-live";
import { useAdminSession } from "./AdminSessionProvider";
import { DigestSession, useDigestSnapshot } from "./digest-session";

type View = "write" | "preview" | "changes";
type Show = AdminDigestsQuery["show"];

const STATE: Record<DigestState, { label: string; icon: IconSvgElement; className: string }> = {
	writing: { label: "Being written", icon: AiMagicIcon, className: "text-black/50 dark:text-white/50" },
	failed: { label: "Not written", icon: Alert02Icon, className: "text-red-700 dark:text-red-300" },
	draft: { label: "Draft", icon: FileClockIcon, className: "text-amber-700 dark:text-amber-300" },
	review: { label: "In review", icon: InboxIcon, className: "text-accent-300 dark:text-accent-700" },
	published: { label: "Published", icon: CheckmarkBadge01Icon, className: "text-emerald-700 dark:text-emerald-300" },
};
const EVENT: Record<DigestEventKind, { icon: IconSvgElement; did: string }> = {
	written: { icon: AiMagicIcon, did: "wrote it" },
	edited: { icon: PencilEdit02Icon, did: "edited the text" },
	submitted: { icon: InboxIcon, did: "sent it for review" },
	withdrawn: { icon: ArrowTurnBackwardIcon, did: "took it back" },
	returned: { icon: ArrowTurnBackwardIcon, did: "sent it back" },
	published: { icon: CheckmarkBadge01Icon, did: "published it" },
};

const muted = "text-black/50 dark:text-white/50";
const line = "border-black/[0.06] dark:border-white/[0.06]";
// The period has its own column where the pane is wide enough to leave the title room; the date tile dates the edition everywhere.
// A phone has room for the edition and where it stands; the counts and who checked it join from the next width up.
const columns = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_10rem] 2xl:grid-cols-[minmax(0,1fr)_11rem_6rem_7rem_11rem]";
const wideOnly = "hidden 2xl:block";
const notOnPhone = "hidden sm:block";
const day = (at: string) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
const time = (at: string) => `${day(at)}, ${new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
const SHOWS = ["all", "draft", "review", "published"] as const satisfies readonly AdminDigestsQuery["show"][];

/** Which page of editions is listed, narrowed and sorted how. Which digests are listed is in the address, so a reload keeps it. */
function useDigestList() {
	const [show, setShow] = useQueryState("digestState", parseAsStringLiteral(SHOWS).withDefault("all"));
	const [{ page, sort }, setPaged] = useState<Pick<AdminDigestsQuery, "page" | "sort">>({ page: 1, sort: "newest" });
	const query = useMemo((): AdminDigestsQuery => ({ page, show, sort }), [page, show, sort]);
	const setQuery = useCallback((change: AdminDigestsQuery | ((query: AdminDigestsQuery) => AdminDigestsQuery)) => {
		const next = typeof change === "function" ? change(query) : change;
		setPaged({ page: next.page, sort: next.sort });
		void setShow(next.show);
	}, [query, setShow]);
	// The list also tells the navigation how many digests wait for review, so it is read while another view is open.
	const list = useSWR(["admin-digests", query] as const, ([, value]) => getAdminDigests(value), { keepPreviousData: true });
	// Another person's step, and an edition the scheduler makes or sends, show as they happen.
	useAdminLive(["digests"], () => list.mutate());
	// Rows kept from the page or filter before are shown dimmed until the new ones arrive.
	return { list: list.data, listStale: list.isLoading && list.data !== undefined, query, setQuery, refreshList: list.mutate };
}

/**
 * A session for an edition that has text and is not being written again. The one already held stays, with what the
 * person typed, unless it has nothing left to save and the library now answers with a later revision.
 */
function sessionToStart(loaded: AdminDigest | undefined, held: DigestSession | undefined) {
	if (!loaded || !loaded.words || loaded.writing) return null;
	if (held && !(held.settled && held.read().digest.revision < loaded.revision)) return null;
	return new DigestSession(loaded, loaded.words);
}

/** Every edition opened keeps its session, so coming back to one finds the text and the revision it was left with. */
function useSessions() {
	const [sessions, setSessions] = useState<ReadonlyMap<string, DigestSession>>(new Map());
	return {
		of: (id: string | null) => (id ? sessions.get(id) : undefined),
		hold: (session: DigestSession | null) => { if (session) setSessions((held) => new Map(held).set(session.id, session)); },
	};
}

/**
 * The browser leaving the page: a reload, a closed tab, or Back to another site. What was typed in the moment before is
 * sent at once, and when it cannot be (the library refused it, or someone else changed the edition) the browser asks
 * before it is lost.
 */
function useLeaving(session: DigestSession | null) {
	useEffect(() => {
		if (!session) return;
		const leave = () => { session.leave(); };
		const ask = (event: BeforeUnloadEvent) => { if (!session.leave()) event.preventDefault(); };
		window.addEventListener("pagehide", leave);
		window.addEventListener("beforeunload", ask);
		return () => {
			window.removeEventListener("pagehide", leave);
			window.removeEventListener("beforeunload", ask);
		};
	}, [session]);
}

/** The open edition and the text a person has in hand for it. */
function useOpenDigest(openId: string | null) {
	const detail = useSWR(openId ? (["admin-digest", openId] as const) : null, ([, id]) => getAdminDigest(id), {
		revalidateOnFocus: false,
		// An edition AI is still writing is asked for again until its text is there.
		refreshInterval: (latest) => (latest?.writing ? 15_000 : 0),
	});
	// Any other is read again when it changes, so another person's step shows; what this person has typed and not saved
	// is never replaced.
	useAdminLive(["digests"], () => detail.mutate());
	const sessions = useSessions();
	const loaded = detail.data && detail.data.id === openId ? detail.data : undefined;
	// A person's session starts once the open edition has text. Later answers never replace what they have typed.
	const starting = sessionToStart(loaded, sessions.of(openId));
	if (starting) sessions.hold(starting);
	const session = starting ?? sessions.of(openId) ?? null;
	const snapshot = useDigestSnapshot(session);
	/** Loads the edition afresh, dropping what this person had typed since someone else changed it. */
	const reload = () => detail.mutate().then((fresh) => sessions.hold(sessionToStart(fresh, undefined)));
	useLeaving(session);
	return { digest: snapshot ? snapshot.digest : loaded, missing: Boolean(detail.error) && !loaded, session, snapshot, reload, refreshOpen: detail.mutate };
}

/**
 * The digests view's state: which page of editions is listed, which edition is open, and the text a person has in hand.
 * `param` is the address's `digests` value: "list", or the open edition.
 */
export function useAdminDigests(param: string | null, setParam: (value: string | null) => void) {
	const openId = param !== null && param !== "list" ? param : null;
	const [view, setView] = useState<View>("write");
	const listed = useDigestList();
	const opened = useOpenDigest(openId);
	const leave = (to: string) => { void opened.session?.save(); setParam(to); };
	const { refreshList } = listed;
	const { refreshOpen } = opened;
	/** Reads the list and the open edition again, as the admin's Refresh does for records. */
	const refresh = useCallback(() => Promise.all([refreshList(), refreshOpen()]), [refreshList, refreshOpen]);
	return {
		...listed,
		...opened,
		openId,
		open: (id: string) => { setView("write"); leave(id); },
		close: () => leave("list"),
		view,
		setView,
		waiting: listed.list?.counts.review ?? 0,
		refresh,
	};
}
type Digests = ReturnType<typeof useAdminDigests>;

function StateChip({ state }: { state: DigestState }) {
	const { label, icon, className } = STATE[state];
	return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${className}`}><HugeiconsIcon icon={icon} aria-hidden size={14} />{label}</span>;
}
function DateTile({ edition, large = false }: { edition: { day: string; month: string }; large?: boolean }) {
	return <span className={`shrink-0 rounded-xl bg-black/[0.04] text-center dark:bg-white/[0.05] ${large ? "w-14 py-2.5" : "w-11 py-1.5"}`}>
		<span className={`block font-semibold leading-none tabular-nums ${large ? "text-xl" : "text-base"}`}>{edition.day}</span>
		<span className={`mt-1 block text-[10px] ${muted}`}>{edition.month}</span>
	</span>;
}
/** Who stands behind an edition: the person who published it, or nobody. */
function Signed({ by, published }: { by: DigestPerson | null; published: boolean }) {
	if (by) return <span className="inline-flex min-w-0 items-center gap-1.5"><Face person={by} size={18} /><span className="truncate">{by.name}</span></span>;
	return <span className={`inline-flex items-center gap-1.5 ${muted}`}><HugeiconsIcon icon={AiMagicIcon} aria-hidden size={14} />{published ? "AI, unchecked" : "Nobody yet"}</span>;
}
const segment = (active: boolean) => `inline-flex items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${active ? "bg-white text-black shadow-sm dark:bg-white/10 dark:text-white" : `${muted} hover:text-black/80 dark:hover:text-white/80`}`;
const range = (page: number, total: number, rows: number) => (total ? `${(page - 1) * rows + 1} to ${Math.min(page * rows, total)} of ${total}` : "None");

const ROWS = 20;
const NO_TITLE: Partial<Record<DigestState, string>> = { writing: "AI is writing this digest" };

function ListRow({ edition, onOpen }: { edition: AdminDigestList["editions"][number]; onOpen: () => void }) {
	return <li>
		<button type="button" onClick={onOpen} className={`${columns} h-[3.75rem] w-full border-b text-left text-[13px] transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus dark:hover:bg-white/[0.04] ${line}`}>
			<span className="flex min-w-0 items-center gap-3"><DateTile edition={edition} /><span className={`truncate font-semibold ${edition.title ? "" : muted}`}>{edition.title ?? NO_TITLE[edition.state] ?? "No text"}</span></span>
			<span className={`truncate ${muted} ${wideOnly}`}>{edition.period}</span>
			<span className={`tabular-nums ${notOnPhone}`}>{edition.publicationCount.toLocaleString("en-GB")}</span>
			<StateChip state={edition.state} />
			<span className={`truncate text-xs ${notOnPhone}`}><Signed by={edition.checkedBy} published={edition.state === "published"} /></span>
		</button>
	</li>;
}

const rowPlaceholder = <><Skeleton className="h-9 w-4/5 rounded-lg" /><Skeleton className={`h-4 w-24 rounded-lg ${wideOnly}`} /><Skeleton className={`h-4 w-10 rounded-lg ${notOnPhone}`} /><Skeleton className="h-4 w-16 rounded-lg" /><Skeleton className={`h-4 w-28 rounded-lg ${notOnPhone}`} /></>;

function ListRows({ list, all, onOpen }: { list: AdminDigestList; all: boolean; onOpen: (id: string) => void }) {
	if (!list.total) return <li className={`px-4 py-6 text-[13px] ${muted}`}>{all ? "No digest has been written yet." : "No digest stands here."}</li>;
	return list.editions.map((edition) => <ListRow key={edition.id} edition={edition} onOpen={() => onOpen(edition.id)} />);
}

/** Where the list stands among its pages, and the way to the others. Its place is kept while the list loads. */
function ListFooter({ list, onPage }: { list: AdminDigestList | undefined; onPage: (page: number) => void }) {
	const { page, pages } = list ?? { page: 1, pages: 1 };
	return <div className={`flex h-12 shrink-0 items-center justify-between gap-3 border-t pl-4 pr-2 ${line}`}>
		<span className={`text-xs tabular-nums ${muted}`}>{list && range(list.page, list.total, ROWS)}</span>
		<Pagination aria-label="Pages of digests" size="sm" showControls siblings={0} total={pages} page={page} onChange={onPage} />
	</div>;
}

/** Every edition, a page at a time: narrowed to where it stands, newest or oldest first. A row opens its edition. */
function DigestList({ digests }: { digests: Digests }) {
	const { list, query, setQuery } = digests;
	return <div className="flex min-h-0 flex-1 flex-col">
		{/* The same header as the record table: a column's name sorts by it. Which digests are listed is chosen in the navigation, as it is for records. */}
		<div className={`${columns} h-10 shrink-0 border-b bg-card_light text-[11px] font-semibold text-black/40 dark:bg-card dark:text-white/40 ${line}`}>
			<SortHeader columnId="edition" label="Edition" sort="edition" sortDirection={query.sort === "oldest" ? "asc" : "desc"} tabIndex={0} onSort={() => setQuery({ ...query, sort: query.sort === "oldest" ? "newest" : "oldest", page: 1 })} /><span className={wideOnly}>Covers</span><span className={notOnPhone}>Publications</span><span>State</span><span className={notOnPhone}>Checked by</span>
		</div>
		<ul className={`min-h-0 flex-1 overflow-y-auto ${digests.listStale ? "pointer-events-none opacity-50" : ""}`}>
			{list ? <ListRows list={list} all={query.show === "all"} onOpen={digests.open} /> : Array.from({ length: 6 }, (_, index) => <li key={index} className={`${columns} h-[3.75rem] border-b ${line}`}>{rowPlaceholder}</li>)}
		</ul>
		<ListFooter list={list} onPage={(page) => setQuery({ ...query, page })} />
	</div>;
}

const NO_TEXT = {
	writing: { icon: AiMagicIcon, title: "AI is writing this digest", text: "Its text appears here when it is done, usually within a few minutes." },
	failed: { icon: Alert02Icon, title: "This digest could not be written", text: "The writer gave up after several attempts." },
};
/** What an edition without text says for itself. */
function NoText({ digest }: { digest: AdminDigest }) {
	const { icon, title, text } = NO_TEXT[digest.state === "writing" ? "writing" : "failed"];
	return <div className={`flex flex-col items-center gap-3 py-24 text-center text-[13px] ${muted}`}>
		<HugeiconsIcon icon={icon} aria-hidden size={22} />
		<p className="font-medium text-black/80 dark:text-white/80">{title}</p>
		<p className="max-w-sm">{digest.error ?? text}</p>
	</div>;
}

type Words = NonNullable<AdminDigest["words"]>;
type Changed = { title: ReturnType<typeof changesBetween>; summary: ReturnType<typeof changesBetween>; markdown: ReturnType<typeof changesBetween> };

/** What differs between the text in hand and the text AI wrote, when that was kept. */
function changesTo(digest: AdminDigest | undefined, words: Words | undefined): Changed | null {
	const ai = digest?.ai;
	if (!ai || !words) return null;
	return { title: changesBetween(ai.title, words.title), summary: changesBetween(ai.summary, words.summary), markdown: changesBetween(ai.markdown, words.markdown) };
}
const editsIn = (changed: Changed | null) => (changed ? editCount(changed.title) + editCount(changed.summary) + editCount(changed.markdown) : 0);

const TABS: [View, string, IconSvgElement][] = [["write", "Write", PencilEdit02Icon], ["preview", "Preview", ViewIcon], ["changes", "Changes", GitCompareIcon]];

/** The open edition's bar: back to the list, its period, the editor's buttons, and how the text is shown. */
function EditionBar({ digests, shown, locked, hasText, edits, setTools }: { digests: Digests; shown: View; locked: boolean; hasText: boolean; edits: number; setTools: (node: HTMLElement | null) => void }) {
	return <div className={`flex h-12 shrink-0 items-center gap-2 border-b px-2 ${line}`}>
		<Button aria-label="All digests" isIconOnly size="xs" variant="transparent" className="shrink-0" onPress={digests.close}><HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden size={16} /></Button>
		{/* A phone has no room for the period beside the tools, and the views go by their icons. */}
		<span className={`min-w-0 flex-1 truncate text-xs ${muted}`}><span className="hidden sm:inline">{digests.digest?.period}</span></span>
		<div ref={setTools} className="flex shrink-0 gap-0.5" />
		<div className="flex shrink-0 rounded-xl bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">
			{TABS.map(([key, label, icon]) => <button key={key} type="button" aria-label={label} aria-pressed={shown === key} disabled={!hasText || (locked && key === "write")} onClick={() => digests.setView(key)} className={`h-8 disabled:opacity-40 ${segment(shown === key)}`}>
				<HugeiconsIcon icon={icon} aria-hidden size={14} /><span className="hidden sm:inline">{label}</span>
				{/* The count's place is kept from the first frame, so the tabs do not move when the edition arrives. */}
				{key === "changes" && <span className="min-w-4 text-left tabular-nums text-accent">{edits || ""}</span>}
			</button>)}
		</div>
	</div>;
}

/** Why the last save or step was refused, with a way on when someone else changed the edition. */
function Problem({ digests }: { digests: Digests }) {
	const { snapshot } = digests;
	if (!snapshot?.problem) return null;
	return <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-red-500/20 bg-red-500/[0.06] px-4 py-2 text-xs text-red-800 dark:text-red-200">
		<HugeiconsIcon icon={Alert02Icon} aria-hidden size={14} className="shrink-0" />
		<span className="min-w-0 flex-1">{snapshot.stale ? "Someone else changed this digest. Load the latest to carry on; what you typed since will be replaced." : snapshot.problem}</span>
		{snapshot.stale && <Button size="xs" variant="muted" className="h-7 shrink-0 rounded-lg px-2.5" startContent={<HugeiconsIcon icon={Refresh01Icon} size={13} />} onPress={() => void digests.reload()}>Load the latest</Button>}
	</div>;
}

function ChangesView({ changed, words }: { changed: Changed | null; words: Words }) {
	const edits = editsIn(changed);
	const summary = !changed ? "The text AI wrote for this digest was not kept" : edits ? `${edits} ${edits === 1 ? "edit" : "edits"} to what AI wrote` : "Nobody has changed what AI wrote";
	return <>
		<div className={`flex items-center gap-2 text-xs ${muted}`}>
			<HugeiconsIcon icon={AiMagicIcon} aria-hidden size={14} />
			<span className="flex-1">{summary}</span>
			{edits > 0 && <><ins className={`px-1.5 py-0.5 ${ADDED}`}>Added</ins><del className={`px-1.5 py-0.5 ${REMOVED}`}>Removed</del></>}
		</div>
		<h1 className="mt-6 text-3xl font-medium leading-tight">{changed ? <ChangedLine parts={changed.title} /> : words.title}</h1>
		<p className={`mt-3 text-base leading-7 ${muted}`}>{changed ? <ChangedLine parts={changed.summary} /> : words.summary}</p>
		<div className="mt-8">{changed ? <ChangedText parts={changed.markdown} /> : <AIMarkdown>{words.markdown}</AIMarkdown>}</div>
	</>;
}

/**
 * The edition as readers will see it. A note is signed by whoever publishes it: the person who did, or for a new note
 * this person when they may publish. Readers see neither the name nor the note unless the library names who checks its digests.
 */
function PreviewView({ digest, words }: { digest: AdminDigest; words: Words }) {
	const account = useAdminSession();
	const mine: DigestSigner | null = account.role === "creator" ? null : { id: account.userId, name: account.name, photo: account.image, role: account.role };
	const signer = words.note === digest.published?.note ? digest.checkedBy : mine;
	return <>
		<h1 className="text-3xl font-medium leading-tight">{words.title}</h1>
		<div className={`mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${muted}`}>
			<span className="inline-flex items-center gap-1.5"><HugeiconsIcon icon={Calendar03Icon} aria-hidden size={14} />{digest.date}</span>
			<span className="inline-flex items-center gap-1.5"><HugeiconsIcon icon={BookOpen01Icon} aria-hidden size={14} />{digest.publicationCount.toLocaleString("en-GB")} publications</span>
			{digest.attribution && <Signed by={digest.checkedBy} published={digest.published !== null} />}
		</div>
		{digest.attribution && words.note && <figure className="mt-7 rounded-2xl bg-black/[0.03] p-5 dark:bg-white/[0.04]"><blockquote className="text-base leading-7">{words.note}</blockquote>{signer && <figcaption className="mt-3 flex items-center gap-2.5 text-sm"><Face person={signer} size={28} /><span className="font-medium">{signer.name}</span>{signer.role && <span className={muted}>{DIGEST_SIGNER_ROLE[signer.role]}</span>}</figcaption>}</figure>}
		<div className="mt-8"><AIMarkdown>{words.markdown}</AIMarkdown></div>
	</>;
}

function WriteView({ session, words, tools }: { session: DigestSession; words: Words; tools: HTMLElement | null }) {
	return <>
		<input aria-label="Title" value={words.title} onChange={(event) => session.change({ title: event.target.value })} className="w-full bg-transparent text-2xl font-medium leading-tight outline-none placeholder:text-black/30" />
		<div className="mt-5"><AdminDigestEditor key={session.key} editionId={session.id} markdown={words.markdown} onChange={(markdown) => session.change({ markdown })} tools={tools} /></div>
	</>;
}

const loading = <div className="space-y-4"><Skeleton className="h-8 w-3/5 rounded-lg" /><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-11/12 rounded-lg" /><Skeleton className="h-4 w-4/5 rounded-lg" /></div>;

/** The open edition's text in the view that is chosen, or what stands in for it while there is none. */
function EditionBody({ digests, shown, words, changed, tools }: { digests: Digests; shown: View; words: Words | undefined; changed: Changed | null; tools: HTMLElement | null }) {
	const { digest, session } = digests;
	if (digests.missing) return <p className={`py-24 text-center text-[13px] ${muted}`}>This digest is no longer available.</p>;
	if (!digest) return loading;
	if (!words) return <NoText digest={digest} />;
	if (shown === "write" && session) return <WriteView session={session} words={words} tools={tools} />;
	return <CitedPublications value={digest.cited}>
		{shown === "changes" ? <ChangesView changed={changed} words={words} /> : <PreviewView digest={digest} words={words} />}
	</CitedPublications>;
}

/** The middle pane: every edition, or the one that is open, as text to write, as readers will see it, or against AI's text. */
export function AdminDigestsMain({ digests }: { digests: Digests }) {
	// The editor's formatting buttons are drawn here, in the pane's bar. A DOM node the editor needs to render into.
	const [tools, setTools] = useState<HTMLElement | null>(null);
	if (!digests.openId) return <DigestList digests={digests} />;
	const { digest, snapshot, view } = digests;
	// AI's text is being replaced, so what is on screen cannot be changed until it is.
	const locked = digest?.writing === true;
	const words = snapshot?.words ?? (locked ? digest.words ?? undefined : undefined);
	const shown: View = locked && view === "write" ? "preview" : view;
	const changed = changesTo(digest, words);
	return <div className="flex min-h-0 flex-1 flex-col">
		<EditionBar digests={digests} shown={shown} locked={locked} hasText={words !== undefined} edits={editsIn(changed)} setTools={setTools} />
		<Problem digests={digests} />
		{locked && <p className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs ${line} ${muted}`}><HugeiconsIcon icon={AiMagicIcon} aria-hidden size={14} />AI is writing this digest again. Its text can be changed when that is done.</p>}
		<div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
			<div className="mx-auto max-w-3xl"><EditionBody digests={digests} shown={shown} words={words} changed={changed} tools={tools} /></div>
		</div>
	</div>;
}

function Row({ icon, label, children }: { icon: IconSvgElement; label: string; children: ReactNode }) {
	return <div className="flex items-center gap-3 px-4 py-2.5 text-[13px]"><HugeiconsIcon icon={icon} aria-hidden size={15} className={`shrink-0 ${muted}`} /><span className={`w-24 shrink-0 ${muted}`}>{label}</span><span className="h-5 min-w-0 flex-1 truncate font-medium leading-5">{children}</span></div>;
}
const field = "mt-2 block w-full resize-none rounded-xl bg-black/[0.04] p-3 text-[13px] leading-5 outline-none placeholder:text-black/35 focus-visible:bg-black/[0.06] disabled:opacity-60 dark:bg-white/[0.05] dark:placeholder:text-white/35";
const wide = "h-9 min-w-0 flex-1 rounded-xl px-3 font-semibold";
const narrow = "h-9 shrink-0 rounded-xl px-3";
const readers = (count: number) => `${count.toLocaleString("en-GB")} ${count === 1 ? "reader" : "readers"}`;

type Offer = { action: DigestAction; label: string; icon: IconSvgElement; primary?: boolean; wide?: boolean };
const SUBMIT: Offer = { action: "submit", label: "Send to queue", icon: InboxIcon, primary: true, wide: true };
/** For an Editor or Owner, beside Publish: the same edition to the review queue instead. */
const QUEUE: Offer = { action: "submit", label: "Send to queue", icon: InboxIcon, wide: true };
const WITHDRAW: Offer = { action: "withdraw", label: "Take back", icon: ArrowTurnBackwardIcon, wide: true };
const RETURN: Offer = { action: "return", label: "Send back", icon: ArrowTurnBackwardIcon };

/** What this person can do with the edition, by where it stands and whether they may publish. */
function offersFor(digest: AdminDigest, canPublish: boolean): Offer[] {
	const publish: Offer = digest.published
		? { action: "publish", label: "Publish changes", icon: CheckmarkBadge01Icon, primary: true, wide: true }
		: { action: "publish", label: "Publish and send", icon: MailSend01Icon, primary: true, wide: true };
	const offers: Partial<Record<DigestState, Offer[]>> = canPublish ? { draft: [QUEUE, publish], review: [RETURN, publish] } : { draft: [SUBMIT], review: [WITHDRAW] };
	return offers[digest.state] ?? [];
}

type Line = { icon: IconSvgElement; text: string };
/** What the edition's standing means for readers and for this person, in a line each. */
function standing(digest: AdminDigest, canPublish: boolean): Line[] {
	if (digest.state === "published") return [digest.sent ? { icon: SentIcon, text: `Sent to ${readers(digest.sent.readers)}` } : { icon: CheckmarkBadge01Icon, text: `Published on ${day(digest.publishedAt!)}` }];
	const lines: Line[] = [];
	if (digest.publishedAt) lines.push({ icon: ViewIcon, text: `Readers see the version of ${day(digest.publishedAt)}` });
	if (digest.state === "review" && !canPublish) lines.push({ icon: InboxIcon, text: "Waiting for an editor" });
	return lines;
}

function Actions({ digest, session, busy }: { digest: AdminDigest; session: DigestSession; busy: DigestAction | null }) {
	const { canPublish } = useAdminSession();
	const offers = offersFor(digest, canPublish);
	return <div className={`shrink-0 space-y-2 border-t p-3 ${line}`}>
		{standing(digest, canPublish).map(({ icon, text }) => <p key={text} className={`flex items-center gap-2 px-1 py-0.5 text-xs ${muted}`}><HugeiconsIcon icon={icon} aria-hidden size={14} />{text}</p>)}
		{offers.length > 0 && <div className="flex gap-2">
			{offers.map((offer) => <Button key={offer.action} size="xs" color={offer.primary ? "accent" : undefined} variant={offer.primary ? undefined : "muted"} className={offer.wide ? wide : narrow} isLoading={busy === offer.action} isDisabled={busy !== null}
				startContent={busy === offer.action ? null : <HugeiconsIcon icon={offer.icon} size={14} />} onPress={() => void session.move(offer.action)}>{offer.label}</Button>)}
		</div>}
	</div>;
}

const nextDigest = (overview: AdminDigestList["overview"]) => {
	if (!overview.sending) return "Digests are off";
	if (overview.paused) return "Paused";
	return overview.next ? `${overview.next.day}, ${overview.next.time}` : "Not scheduled";
};

/** The library's settings page on OpenScholar, opened at its digests. */
function digestSettingsHref(configurationHref: string) {
	const url = new URL(configurationHref);
	url.searchParams.set("section", "notifications");
	return url.toString();
}

/** What the library's digests are set to do, shown while no edition is open. */
function Overview({ overview, configurationHref }: { overview: AdminDigestList["overview"] | undefined; configurationHref: string }) {
	return <div className="flex h-full flex-col">
		<div className="py-2">
			<Row icon={overview?.paused ? PauseIcon : Calendar03Icon} label="Next digest">{overview ? nextDigest(overview) : <Skeleton className="my-0.5 h-4 w-32 rounded-lg" />}</Row>
			<Row icon={CheckmarkBadge01Icon} label="Before sending">{overview ? (overview.approval ? "An editor publishes it" : "Sent as AI wrote it") : <Skeleton className="my-0.5 h-4 w-32 rounded-lg" />}</Row>
			<Row icon={UserCheck01Icon} label="Readers see">{overview ? (overview.attribution ? "Who checked it" : "No name") : <Skeleton className="my-0.5 h-4 w-24 rounded-lg" />}</Row>
			<Row icon={MailSend01Icon} label="Subscribers">{overview ? overview.subscribers.toLocaleString("en-GB") : <Skeleton className="my-0.5 h-4 w-10 rounded-lg" />}</Row>
		</div>
		<div className="px-4"><a href={digestSettingsHref(configurationHref)} className={`inline-flex items-center gap-1.5 text-xs font-medium hover:text-accent ${muted}`}><HugeiconsIcon icon={Settings02Icon} aria-hidden size={14} />Digest settings</a></div>
	</div>;
}

type Step = { icon: IconSvgElement; who: string; did: string; at: string; actor: DigestPerson | null };
/** Who did what to the edition and when, ending with the readers it reached. */
function Trail({ digest }: { digest: AdminDigest }) {
	const steps: Step[] = digest.events.map((event) => ({ icon: EVENT[event.kind].icon, who: event.actor?.name ?? "AI", did: EVENT[event.kind].did, at: event.at, actor: event.actor }));
	if (digest.sent) steps.push({ icon: SentIcon, who: readers(digest.sent.readers), did: "received it", at: digest.sent.at, actor: null });
	return <ol className={`border-y py-2 ${line}`}>
		{/* A step that happens while the edition is open, such as this person's first save, opens its row instead of pushing the fields below down in one frame. */}
		<AnimatePresence initial={false}>
			{steps.map((step, index) => <motion.li key={index} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} transition={{ duration: 0.2, ease: "easeOut" }} className="overflow-hidden">
				<span className="flex items-center gap-3 px-4 py-2 text-[13px]">
					<span className="flex shrink-0 self-start">{step.actor ? <Face person={step.actor} size={28} /> : <span className="grid size-7 shrink-0 place-items-center rounded-full bg-black/[0.05] dark:bg-white/[0.07]"><HugeiconsIcon icon={step.icon} aria-hidden size={14} /></span>}</span>
					<span className="min-w-0 flex-1"><span className="block truncate font-medium">{step.who}</span><span className={`block truncate text-xs ${muted}`}>{step.did}</span></span>
					<span className={`shrink-0 text-[11px] tabular-nums ${muted}`}>{time(step.at)}</span>
				</span>
			</motion.li>)}
		</AnimatePresence>
	</ol>;
}

const NOTE_SHOWN = "A few words of your own, shown above the digest with the name of whoever publishes it";
const NOTE_HIDDEN = "Not shown to readers: the community does not name who checks its digests";

function Fields({ session, words, locked, attribution }: { session: DigestSession; words: Words; locked: boolean; attribution: boolean }) {
	return <>
		<label className="block px-4 pt-4">
			<span className="text-[13px] font-semibold">Summary</span>
			<textarea value={words.summary} disabled={locked} onChange={(event) => session.change({ summary: event.target.value.replace(/\n/g, " ") })} rows={4} placeholder="One or two sentences, shown under the title in the list of digests" className={field} />
		</label>
		<label className="block px-4 py-4">
			<span className="text-[13px] font-semibold">Editor&apos;s note</span>
			<textarea value={words.note} disabled={locked} onChange={(event) => session.change({ note: event.target.value })} rows={4} placeholder={attribution ? NOTE_SHOWN : NOTE_HIDDEN} className={field} />
		</label>
	</>;
}

/** The right pane: where an edition stands, who did what, its summary and the editor's note, and what this person may do next. */
export function AdminDigestsInspector({ digests, configurationHref }: { digests: Digests; configurationHref: string }) {
	const { digest, session, snapshot } = digests;
	if (!digests.openId) return <Overview overview={digests.list?.overview} configurationHref={configurationHref} />;
	if (!digest) return <div className="space-y-3 p-4"><Skeleton className="h-14 w-full rounded-xl" /><Skeleton className="h-4 w-3/5 rounded-lg" /><Skeleton className="h-4 w-2/5 rounded-lg" /></div>;
	const editing = session && snapshot ? { session, snapshot } : null;
	return <div className="flex h-full min-h-0 flex-col">
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="flex items-center gap-3 px-4 pb-3 pt-4"><span className="flex shrink-0 self-start"><DateTile edition={digest} large /></span><div className="min-w-0"><p className="truncate text-[13px] font-semibold">{digest.period}</p><p className={`mt-1 text-xs ${muted}`}>{digest.publicationCount.toLocaleString("en-GB")} publications</p></div><span className="ml-auto"><StateChip state={digest.state} /></span></div>
			<Trail digest={digest} />
			{editing && <Fields session={editing.session} words={editing.snapshot.words} locked={digest.writing} attribution={digest.attribution} />}
		</div>
		{editing && !digest.writing && <Actions digest={digest} session={editing.session} busy={editing.snapshot.busy} />}
	</div>;
}
