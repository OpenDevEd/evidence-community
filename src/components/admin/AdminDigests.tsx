"use client";

// MOCK: digests in the admin panel. A creator edits a digest and sends it for review; an editor or owner
// approves it, and it goes out signed with their name. The editions, the people and every action live in
// this file and in the browser: nothing is read from or written to the library.
import { useState, type ReactNode } from "react";
import {
	AiMagicIcon,
	ArrowLeft01Icon,
	ArrowTurnBackwardIcon,
	BookOpen01Icon,
	Calendar03Icon,
	CheckmarkBadge01Icon,
	FileClockIcon,
	GitCompareIcon,
	InboxIcon,
	MailSend01Icon,
	PencilEdit02Icon,
	SentIcon,
	Settings02Icon,
	UserCheck01Icon,
	ViewIcon,
} from "@hugeicons/core-free-icons";

import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { AIMarkdown } from "@/components/features/markdown/Markdown";
import { Button } from "@/components/nextui/Button";
import { ADDED, ChangedLine, ChangedText, changesBetween, editCount, REMOVED } from "./AdminDigestChanges";
import { AdminDigestEditor } from "./AdminDigestEditor";
import { Face } from "@/components/digests/DigestPrimitives";
import { MOCK_MARKDOWN, MOCK_SUMMARY, MOCK_TITLE, PEOPLE as PERSONS, type MockPerson } from "@/components/digests/mockEditorial";

// The same steps a record takes: a draft, sent for review, then published by an Editor or Owner. Publishing sends it.
type Status = "draft" | "review" | "sent";
type Role = "creator" | "editor";
type Step = { icon: IconSvgElement; who: string; did: string; when: string; /** The person who did it, shown by their photo. */ person?: MockPerson };
type Text = { title: string; summary: string; markdown: string };
type Edition = Text & {
	id: string;
	day: number;
	month: string;
	period: string;
	publications: number;
	/** The text as AI wrote it, kept so a reviewer can see what a person changed. */
	ai: Text;
	status: Status;
	note: string;
	trail: Step[];
	checkedBy?: MockPerson;
};

// A creator without a photo and an editor with one.
const PEOPLE: Record<Role, MockPerson> = { creator: PERSONS.eunice, editor: PERSONS.gugulethu };
const did = (person: MockPerson, icon: IconSvgElement, what: string, when: string): Step => ({ icon, who: person.name, did: what, when, person });
const AI_WROTE = (when: string): Step => ({ icon: AiMagicIcon, who: "AI", did: "wrote it", when });

const STATUS: Record<Status, { label: string; icon: IconSvgElement; className: string }> = {
	draft: { label: "Draft", icon: FileClockIcon, className: "text-amber-700 dark:text-amber-300" },
	review: { label: "In review", icon: InboxIcon, className: "text-accent-300 dark:text-accent-700" },
	sent: { label: "Published", icon: CheckmarkBadge01Icon, className: "text-emerald-700 dark:text-emerald-300" },
};

const OLDER = "## Meta-analyses and reviews\n\nTwo reviews came out this month.\n\n## Agriculture\n\n**Kenya.** Farmers who received seasonal forecasts by text message planted two weeks earlier on average.\n";
const OLDER_SUMMARY = "Two reviews this month, and a study of seasonal forecasts sent to farmers in Kenya by text message.";
/** An edition nobody has changed: its text is AI's. */
const written = (title: string, summary: string, markdown: string): Text & { ai: Text } => ({ title, summary, markdown, ai: { title, summary, markdown } });

// What the creator changed before sending the edition for review: a sentence split, a review taken out, a phrase reworded and a study added.
const EDITED = MOCK_MARKDOWN
	.replace("Fourteen reviews did, and six of them report", "Fourteen reviews did. Six of them report")
	.replace(" A scoping review of 27 studies of family doctors found that few had a routine for spotting patients at risk in a heatwave [Ardiabah et al., 2026](/lib/K55PGM43).", "")
	.replace("where the authors say the larger losses fall", "where the authors say most of the losses happen")
	.replace("[Meena et al., 2026](/lib/3LV98WXQ).", "[Meena et al., 2026](/lib/3LV98WXQ). A second study of the same regions found that the damage lasted into the next growing season [Ding et al., 2026](/lib/7UMM9GMJ).");

const EDITIONS: Edition[] = [
	{ id: "next", day: 12, month: "Oct", period: "5 to 12 October", publications: 298, ...written(MOCK_TITLE, MOCK_SUMMARY, MOCK_MARKDOWN), status: "draft", note: "", trail: [AI_WROTE("Today, 06:00")] },
	{
		id: "review", day: 5, month: "Oct", period: "28 September to 5 October", publications: 316, status: "review", note: "",
		title: "Climate risk meets local choices", summary: MOCK_SUMMARY.replace("Fourteen reviews", "Thirteen reviews"), markdown: EDITED,
		ai: { title: "Climate risk, local choices and the plans between them", summary: MOCK_SUMMARY, markdown: MOCK_MARKDOWN },
		trail: [AI_WROTE("5 October, 06:00"), did(PEOPLE.creator, PencilEdit02Icon, "edited the text", "6 October, 14:12"), did(PEOPLE.creator, InboxIcon, "sent it for review", "6 October, 14:20")],
	},
	{
		id: "sep", day: 1, month: "Oct", period: "September 2026", publications: 1853, ...written("September 2026 heat, drought and adaptation choices", OLDER_SUMMARY, OLDER), status: "sent", checkedBy: PEOPLE.editor,
		note: "The Ethiopia food systems review is the one I would read first this month.",
		trail: [AI_WROTE("1 October, 06:00"), did(PEOPLE.editor, CheckmarkBadge01Icon, "published it", "1 October, 08:41"), { icon: SentIcon, who: "1,024 readers", did: "received it", when: "1 October, 09:00" }],
	},
	{ id: "aug", day: 1, month: "Sep", period: "August 2026", publications: 1611, ...written("Heat, drought and adaptation in practice", OLDER_SUMMARY, OLDER), status: "sent", note: "", trail: [AI_WROTE("1 September, 06:00"), { icon: SentIcon, who: "987 readers", did: "received it", when: "1 September, 09:00" }] },
	{ id: "jul", day: 1, month: "Aug", period: "July 2026", publications: 1702, ...written("Climate adaptation under heat and water stress", OLDER_SUMMARY, OLDER), status: "sent", checkedBy: PERSONS.mohammed, note: "", trail: [AI_WROTE("1 August, 06:00"), did(PERSONS.mohammed, CheckmarkBadge01Icon, "published it", "1 August, 08:02"), { icon: SentIcon, who: "941 readers", did: "received it", when: "1 August, 09:00" }] },
];

const muted = "text-black/50 dark:text-white/50";
type View = "write" | "preview" | "changes";

export function useMockDigests(openId: string | null, setOpenId: (id: string | null) => void) {
	const [editions, setEditions] = useState(EDITIONS);
	const [role, setRole] = useState<Role>("creator");
	const [view, setView] = useState<View>("write");
	const open = editions.find((edition) => edition.id === openId) ?? null;
	const change = (patch: Partial<Edition>) => setEditions((all) => all.map((edition) => (edition.id === openId ? { ...edition, ...patch } : edition)));
	const move = (status: Status, icon: IconSvgElement, what: string, patch: Partial<Edition> = {}) =>
		open && change({ status, trail: [...open.trail, did(PEOPLE[role], icon, what, "Just now")], ...patch });
	return { editions, open, setOpenId, role, setRole, view, setView, change, move, waiting: editions.filter((edition) => edition.status === "review").length };
}
type Digests = ReturnType<typeof useMockDigests>;

function StatusChip({ status }: { status: Status }) {
	const { label, icon, className } = STATUS[status];
	return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${className}`}><HugeiconsIcon icon={icon} aria-hidden size={14} />{label}</span>;
}
function DateTile({ edition, large = false }: { edition: Edition; large?: boolean }) {
	return <span className={`shrink-0 rounded-xl bg-black/[0.04] text-center dark:bg-white/[0.05] ${large ? "w-14 py-2.5" : "w-11 py-1.5"}`}>
		<span className={`block font-semibold leading-none tabular-nums ${large ? "text-xl" : "text-base"}`}>{edition.day}</span>
		<span className={`mt-1 block text-[10px] ${muted}`}>{edition.month}</span>
	</span>;
}
/** Who stands behind an edition, as readers see it. */
function Signed({ edition }: { edition: Edition }) {
	return edition.checkedBy
		? <span className="inline-flex items-center gap-1.5"><Face person={edition.checkedBy} size={18} />{edition.checkedBy.name}</span>
		: <span className={`inline-flex items-center gap-1.5 ${muted}`}><HugeiconsIcon icon={AiMagicIcon} aria-hidden size={14} />{edition.status === "sent" ? "AI, unchecked" : "Nobody yet"}</span>;
}

/** The middle pane: every edition, or the one that is open, as text to write or as readers will see it. */
export function AdminDigestsMain({ digests }: { digests: Digests }) {
	const { open, editions, setOpenId, view, setView, change } = digests;
	// The editor's formatting buttons are drawn here, in the pane's bar. A DOM node the editor needs to render into.
	const [tools, setTools] = useState<HTMLElement | null>(null);
	if (!open) {
		return <div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 dark:border-white/[0.06]">
				<h2 className="text-[13px] font-semibold">Digests</h2>
				<span className={`inline-flex items-center gap-1.5 text-xs ${muted}`}><HugeiconsIcon icon={Calendar03Icon} aria-hidden size={13} />Mondays at 09:00</span>
			</div>
			<div className={`grid shrink-0 grid-cols-[minmax(0,1fr)_11rem_6rem_6rem_11rem] gap-4 border-b border-black/[0.06] px-4 py-3 text-[11px] font-semibold dark:border-white/[0.06] ${muted}`}>
				<span>Edition</span><span>Covers</span><span>Publications</span><span>State</span><span>Checked by</span>
			</div>
			<ul className="min-h-0 flex-1 overflow-y-auto">
				{editions.map((edition) => <li key={edition.id}>
					<button type="button" onClick={() => setOpenId(edition.id)} className="grid w-full grid-cols-[minmax(0,1fr)_11rem_6rem_6rem_11rem] items-center gap-4 border-b border-black/[0.05] px-4 py-3 text-left text-[13px] transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus dark:border-white/[0.05] dark:hover:bg-white/[0.04]">
						<span className="flex min-w-0 items-center gap-3"><DateTile edition={edition} /><span className="truncate font-semibold">{edition.title}</span></span>
						<span className={`truncate ${muted}`}>{edition.period}</span>
						<span className="tabular-nums">{edition.publications.toLocaleString()}</span>
						<StatusChip status={edition.status} />
						<span className="truncate text-xs"><Signed edition={edition} /></span>
					</button>
				</li>)}
			</ul>
		</div>;
	}
	const changed = { title: changesBetween(open.ai.title, open.title), summary: changesBetween(open.ai.summary, open.summary), markdown: changesBetween(open.ai.markdown, open.markdown) };
	const edits = editCount(changed.title) + editCount(changed.summary) + editCount(changed.markdown);
	const tab = (key: View, label: string, icon: IconSvgElement, count = 0) =>
		<button type="button" aria-pressed={view === key} onClick={() => setView(key)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${view === key ? "bg-white text-black shadow-sm dark:bg-white/10 dark:text-white" : `${muted} hover:text-black/80 dark:hover:text-white/80`}`}>
			<HugeiconsIcon icon={icon} aria-hidden size={14} />{label}{count > 0 && <span className="tabular-nums text-accent">{count}</span>}
		</button>;
	return <div className="flex min-h-0 flex-1 flex-col">
		<div className="flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.06] px-2 dark:border-white/[0.06]">
			<Button aria-label="All digests" isIconOnly size="xs" variant="transparent" onPress={() => setOpenId("list")}><HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden size={16} /></Button>
			<span className={`min-w-0 flex-1 truncate text-xs ${muted}`}>{open.period}</span>
			<div ref={setTools} className="flex gap-0.5" />
			<div className="flex rounded-xl bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">{tab("write", "Write", PencilEdit02Icon)}{tab("preview", "Preview", ViewIcon)}{tab("changes", "Changes", GitCompareIcon, edits)}</div>
		</div>
		<div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
			<div className="mx-auto max-w-3xl">
				{view === "write" ? <>
					<input aria-label="Title" value={open.title} onChange={(event) => change({ title: event.target.value })} className="w-full bg-transparent text-2xl font-medium leading-tight outline-none placeholder:text-black/30" />
					<div className="mt-5"><AdminDigestEditor key={open.id} markdown={open.markdown} onChange={(markdown) => change({ markdown })} tools={tools} /></div>
				</> : view === "changes" ? <>
					<div className={`flex items-center gap-2 text-xs ${muted}`}>
						<HugeiconsIcon icon={AiMagicIcon} aria-hidden size={14} />
						<span className="flex-1">{edits ? `${edits} ${edits === 1 ? "edit" : "edits"} to what AI wrote` : "Nobody has changed what AI wrote"}</span>
						{edits > 0 && <><ins className={`px-1.5 py-0.5 ${ADDED}`}>Added</ins><del className={`px-1.5 py-0.5 ${REMOVED}`}>Removed</del></>}
					</div>
					<h1 className="mt-6 text-3xl font-medium leading-tight"><ChangedLine parts={changed.title} /></h1>
					<p className={`mt-3 text-base leading-7 ${muted}`}><ChangedLine parts={changed.summary} /></p>
					<div className="mt-8"><ChangedText parts={changed.markdown} /></div>
				</> : <>
					<h1 className="text-3xl font-medium leading-tight">{open.title}</h1>
					<div className={`mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${muted}`}>
						<span className="inline-flex items-center gap-1.5"><HugeiconsIcon icon={Calendar03Icon} aria-hidden size={14} />{open.day} {open.month} 2026</span>
						<span className="inline-flex items-center gap-1.5"><HugeiconsIcon icon={BookOpen01Icon} aria-hidden size={14} />{open.publications.toLocaleString()} publications</span>
						<Signed edition={open} />
					</div>
					{open.note && <figure className="mt-7 rounded-2xl bg-black/[0.03] p-5 dark:bg-white/[0.04]"><blockquote className="text-base leading-7">{open.note}</blockquote><figcaption className="mt-3 flex items-center gap-2.5 text-sm font-medium"><Face person={open.checkedBy ?? PEOPLE[digests.role]} size={28} />{(open.checkedBy ?? PEOPLE[digests.role]).name}</figcaption></figure>}
					<div className="mt-8"><AIMarkdown>{open.markdown}</AIMarkdown></div>
				</>}
			</div>
		</div>
	</div>;
}

function Row({ icon, label, children }: { icon: IconSvgElement; label: string; children: ReactNode }) {
	return <div className="flex items-center gap-3 px-4 py-2.5 text-[13px]"><HugeiconsIcon icon={icon} aria-hidden size={15} className={`shrink-0 ${muted}`} /><span className={`w-24 shrink-0 ${muted}`}>{label}</span><span className="min-w-0 flex-1 truncate font-medium">{children}</span></div>;
}
const action = "h-9 min-w-0 flex-1 rounded-xl px-3 font-semibold";

/** The right pane: where an edition stands, who did what, the editor's note, and what this person may do next. */
export function AdminDigestsInspector({ digests, configurationHref }: { digests: Digests; configurationHref: string }) {
	const { open, role, setRole, change, move } = digests;
	const roleSwitch = <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-4 py-2.5 text-[11px] dark:border-white/[0.06]">
		<span className={`rounded-md bg-black/[0.06] px-1.5 py-0.5 font-semibold dark:bg-white/10 ${muted}`}>Mock</span><span className={muted}>Signed in as</span>
		<div className="ml-auto flex rounded-lg bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">{(["creator", "editor"] as const).map((key) =>
			<button key={key} type="button" aria-pressed={role === key} onClick={() => setRole(key)} className={`h-6 rounded-md px-2.5 font-medium capitalize transition-colors ${role === key ? "bg-white text-black shadow-sm dark:bg-white/10 dark:text-white" : muted}`}>{key}</button>)}
		</div>
	</div>;
	if (!open) {
		return <div className="flex h-full flex-col">{roleSwitch}
			<div className="py-2">
				<Row icon={Calendar03Icon} label="Next digest">Monday 12 October, 09:00</Row>
				<Row icon={CheckmarkBadge01Icon} label="Before sending">An editor publishes it</Row>
				<Row icon={UserCheck01Icon} label="Readers see">Who checked it</Row>
				<Row icon={MailSend01Icon} label="Subscribers">1,024</Row>
			</div>
			<div className="px-4"><a href={configurationHref} className={`inline-flex items-center gap-1.5 text-xs font-medium hover:text-accent ${muted}`}><HugeiconsIcon icon={Settings02Icon} aria-hidden size={14} />Digest settings</a></div>
		</div>;
	}
	const editor = role === "editor";
	return <div className="flex h-full min-h-0 flex-col">{roleSwitch}
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="flex items-center gap-3 px-4 pb-3 pt-4"><DateTile edition={open} large /><div className="min-w-0"><p className="truncate text-[13px] font-semibold">{open.period}</p><p className={`mt-1 text-xs ${muted}`}>{open.publications.toLocaleString()} publications</p></div><span className="ml-auto"><StatusChip status={open.status} /></span></div>
			<ol className="border-y border-black/[0.06] py-2 dark:border-white/[0.06]">
				{open.trail.map((step, index) => <li key={index} className="flex items-center gap-3 px-4 py-2 text-[13px]">
					{step.person ? <Face person={step.person} size={28} /> : <span className="grid size-7 shrink-0 place-items-center rounded-full bg-black/[0.05] dark:bg-white/[0.07]"><HugeiconsIcon icon={step.icon} aria-hidden size={14} /></span>}
					<span className="min-w-0 flex-1"><span className="block truncate font-medium">{step.who}</span><span className={`block truncate text-xs ${muted}`}>{step.did}</span></span>
					<span className={`shrink-0 text-[11px] tabular-nums ${muted}`}>{step.when}</span>
				</li>)}
			</ol>
			<label className="block px-4 pt-4">
				<span className="text-[13px] font-semibold">Summary</span>
				<textarea value={open.summary} onChange={(event) => change({ summary: event.target.value })} rows={4} placeholder="One or two sentences, shown under the title in the list of digests" className="mt-2 block w-full resize-none rounded-xl bg-black/[0.04] p-3 text-[13px] leading-5 outline-none placeholder:text-black/35 focus-visible:bg-black/[0.06] dark:bg-white/[0.05] dark:placeholder:text-white/35" />
			</label>
			<label className="block px-4 py-4">
				<span className="text-[13px] font-semibold">Editor&apos;s note</span>
				<textarea value={open.note} onChange={(event) => change({ note: event.target.value })} rows={4} placeholder="A few words of your own, shown above the digest with your name" className="mt-2 block w-full resize-none rounded-xl bg-black/[0.04] p-3 text-[13px] leading-5 outline-none placeholder:text-black/35 focus-visible:bg-black/[0.06] disabled:opacity-60 dark:bg-white/[0.05] dark:placeholder:text-white/35" />
			</label>
			<div className="px-4 pb-4"><Row icon={UserCheck01Icon} label="Readers see"><Signed edition={open.status === "sent" || open.checkedBy ? open : { ...open, checkedBy: editor ? PEOPLE.editor : undefined }} /></Row></div>
		</div>
		<div className="shrink-0 space-y-2 border-t border-black/[0.06] p-3 dark:border-white/[0.06]">
			{open.status === "review" && !editor && <p className={`flex items-center gap-2 px-1 text-xs ${muted}`}><HugeiconsIcon icon={InboxIcon} aria-hidden size={14} />Waiting for an editor</p>}
			{open.status === "sent" && <p className={`flex items-center gap-2 px-1 py-1.5 text-xs ${muted}`}><HugeiconsIcon icon={SentIcon} aria-hidden size={14} />Sent to 1,024 readers. Edits change the page.</p>}
			<div className="flex gap-2">
				{open.status === "draft" && !editor && <Button size="xs" color="accent" className={action} startContent={<HugeiconsIcon icon={InboxIcon} size={14} />} onPress={() => move("review", InboxIcon, "sent it for review")}>Send for review</Button>}
				{open.status === "review" && !editor && <Button size="xs" variant="muted" className={action} startContent={<HugeiconsIcon icon={ArrowTurnBackwardIcon} size={14} />} onPress={() => move("draft", ArrowTurnBackwardIcon, "took it back")}>Take back</Button>}
				{open.status === "review" && editor && <Button size="xs" variant="muted" className="h-9 shrink-0 rounded-xl px-3" startContent={<HugeiconsIcon icon={ArrowTurnBackwardIcon} size={14} />} onPress={() => move("draft", ArrowTurnBackwardIcon, "sent it back")}>Send back</Button>}
				{open.status !== "sent" && editor && <Button size="xs" color="accent" className={action} startContent={<HugeiconsIcon icon={MailSend01Icon} size={14} />} onPress={() => move("sent", CheckmarkBadge01Icon, "published it", { checkedBy: PEOPLE.editor })}>Publish and send</Button>}
			</div>
		</div>
	</div>;
}
