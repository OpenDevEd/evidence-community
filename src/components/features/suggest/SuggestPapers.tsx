"use client";

import { useEffect, useRef, useState } from "react";
import { ModalBody, ModalContent, ModalFooter, ModalHeader, Chip } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { Add01Icon, ArrowUpRight01Icon, Cancel01Icon, CheckmarkCircle02Icon, File01Icon, InboxIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import useSWR, { useSWRConfig } from "swr";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import DialogModal from "@/components/nextui/DialogModal";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import { Spinner } from "@/components/nextui/Spinner";
import { SUGGEST_PARAM, useOpenScholarUrl, useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { Link } from "@/i18n/routing";
import { paperLinkKey, paperLinkOf } from "@/lib/paper-links";

const OPEN_EVENT = "suggest-papers:open";
/** Opens the dialog from anywhere on the page, on a paper (a link, DOI or ID) when one is named. For a signed-in reader. */
export const openSuggestPapers = (paper?: unknown) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: typeof paper === "string" ? paper : "" }));

/**
 * What every Suggest button does: opens the dialog, on the paper named if any. Someone signed out signs in first and
 * comes back to this page with the dialog open, as if they had been signed in when they pressed.
 */
export function useSuggest() {
	const { reader, signInToSuggest } = useReaderSession();
	return (paper = "") => (reader ? void openSuggestPapers(paper) : signInToSuggest(paper));
}

/** Papers one request looks up or sends at most, as the community takes them. */
const PER_REQUEST = 100;
/** The shortest title worth searching for. */
const TITLE_MIN = 3;

type Reference = { openalexId?: string; doi?: string; link?: string };
type Looked = { key: string; raw: string; ref: Reference };
type Paper = { title: string; authors: string; year: number | null; openalexId?: string | null; doi?: string | null };
type Answer = { outcome: "found" | "existing" | "queued" | "returned" | "not_found"; itemKey?: string; paper?: Paper };
/** `picked`: goes with the next send. A paper pasted is picked once found; one a title found is picked with Add. */
type Row = Looked & { state: "looking" | "found" | "here" | "waiting" | "missing"; picked: boolean; title?: string; authors?: string; year?: number | null };
type Sent = { outcome: string; message?: string };

/** A link, DOI or ID as the community's lookups take it. A link only Openscholar can follow goes as given, which asks it. */
function looked(raw: string): Looked | null {
	const link = paperLinkOf(raw);
	const key = link ? paperLinkKey(link) : null;
	if (!link || !key) return null;
	return { key, raw, ref: link.kind === "work" ? { openalexId: link.openalexId } : link.kind === "doi" ? { doi: link.doi } : { link: raw } };
}

/** The papers a paste names: DOIs, OpenAlex IDs and every address that names one, Openscholar's and communities' included; each once. */
function parse(text: string): Looked[] {
	const seen = new Set<string>();
	return text.split(/\s+/u).filter(Boolean).flatMap((raw) => {
		const paper = looked(raw);
		if (!paper || seen.has(paper.key)) return [];
		seen.add(paper.key);
		return [paper];
	});
}

/** Whether a search is nothing but one paper's link, DOI or ID. */
export const namesPaper = (search: string) => !/\s/u.test(search.trim()) && looked(search.trim()) !== null;

/** What a paste holds that names no paper, said back so the reader knows what was left out. */
const unnamed = (text: string) => text.split(/\s+/u).filter((raw) => raw && !paperLinkOf(raw));

/** Where a paper looked up stands: new here (or returned before, so it can be sent again), already here, waiting, or not found. */
const STATE_OF: Record<Answer["outcome"], Row["state"]> = { found: "found", returned: "found", existing: "here", queued: "waiting", not_found: "missing" };

/** Asks the community; the refusal it gives, if any, is the error's message. */
async function call<T>(query = "", init?: RequestInit): Promise<T> {
	const response = await fetch(`/api/reader/papers${query}`, { ...init, headers: { "Content-Type": "application/json" } });
	const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!response.ok || !body) throw new Error(body?.error ?? "");
	return body;
}

const post = <T,>(body: object) => call<T>("", { method: "POST", body: JSON.stringify(body) });
// A request that never reached the community fails as a TypeError whose words are the browser's ("Load failed", "Failed
// to fetch"): it says it couldn't reach the community instead. Any other error is the community's own words.
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && !(error instanceof TypeError) && error.message ? error.message : fallback);

/** The paper a link, DOI or ID names and where it stands here, read once for the search's row and the dialog it opens. */
function usePaperNamed(raw: string | null) {
	return useSWR(raw ? ["paper-named", raw] : null, () => call<Answer>(`?paper=${encodeURIComponent(raw!)}`), { revalidateOnFocus: false });
}

/** How many more papers the reader may suggest here today, read while they are signed in so the dialog opens knowing it. */
const LEFT_KEY = "suggest-papers-left";
const useLeft = (signedIn: boolean) => useSWR(signedIn ? LEFT_KEY : null, () => call<{ left: number }>().then(({ left }) => left));

const rowMotion = { initial: { height: 0, opacity: 0 }, animate: { height: "4.5rem", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: 0.2 } };

/** One paper looked up: what it is, and where it stands here, a button to add it, or one to leave it out. */
function PaperRow({ row, onAdd, onLeaveOut }: { row: Row; onAdd: () => void; onLeaveOut: () => void }) {
	const t = useTranslations("suggestPapers");
	const known = row.state === "here" || row.state === "waiting";
	return (
		<motion.li {...rowMotion} className="overflow-hidden">
			<div className={`flex h-[4.5rem] items-center gap-3 px-3 ${known ? "opacity-60" : ""}`}>
				{row.state === "looking" ? <Spinner size="sm" /> : row.picked && row.state === "found" ? <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-5 shrink-0 text-accent" aria-hidden /> : null}
				<div className="min-w-0 flex-1">
					<p className="line-clamp-2 text-sm/5 font-medium">{row.title ?? <span className="font-mono text-xs">{row.raw}</span>}</p>
					{row.title ? (
						<p className="flex min-w-0 gap-2 text-xs text-foreground/60 dark:text-white/60">
							<span className="truncate">{row.authors || t("noAuthors")}</span>
							{row.year ? <span className="shrink-0 tabular-nums">{row.year}</span> : null}
						</p>
					) : null}
				</div>
				<RowEnd row={row} onAdd={onAdd} onLeaveOut={onLeaveOut} />
			</div>
		</motion.li>
	);
}

/** Where a paper looked up stands here, the button that adds one a title found, or the one that leaves a picked one out. */
function RowEnd({ row, onAdd, onLeaveOut }: { row: Row; onAdd: () => void; onLeaveOut: () => void }) {
	const t = useTranslations("suggestPapers");
	if (row.state === "here" || row.state === "waiting")
		return (
			<Chip size="sm" variant="flat" startContent={<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" aria-hidden />}>
				{row.state === "here" ? t("alreadyHere") : t("waiting")}
			</Chip>
		);
	if (row.state === "missing") return <Chip size="sm" variant="flat" color="danger">{t("notFound")}</Chip>;
	if (row.state !== "found") return null;
	if (!row.picked)
		return (
			<Button size="sm" variant="bordered" className="shrink-0" aria-label={t("addTitle", { title: row.title ?? row.raw })} onPress={onAdd} startContent={<HugeiconsIcon icon={Add01Icon} className="size-4" aria-hidden />}>
				{t("add")}
			</Button>
		);
	return (
		<Button isIconOnly size="sm" variant="light" aria-label={t("leaveOut", { title: row.title ?? row.raw })} onPress={onLeaveOut}>
			<HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
		</Button>
	);
}

/** Said once the papers are sent: how many, and where the reader follows them. */
function SentPanel({ count }: { count: number }) {
	const t = useTranslations("suggestPapers");
	const openScholar = useOpenScholarUrl();
	return (
		<div className="flex flex-col items-center gap-3 py-8 text-center">
			<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-10 text-success" aria-hidden />
			<p className="text-base font-medium">{t("sent", { count })}</p>
			<p className="max-w-sm text-sm text-foreground/60 dark:text-white/60">{t("sentHint")}</p>
			<Button as="a" href={openScholar("/evidence-communities?view=submissions")} target="_blank" rel="noopener noreferrer" size="sm" variant="bordered" endContent={<HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4" aria-hidden />}>
				{t("yourSubmissions")}
			</Button>
		</div>
	);
}

/** What the field says beside Find papers: the day's limit, or why the last try failed. */
function hintOf(t: ReturnType<typeof useTranslations<"suggestPapers">>, left: number | undefined, named: number, room: number, problem: string, invalid: string[]) {
	// Until the allowance is known, only why it couldn't be read.
	if (left === undefined) return problem;
	if (left === 0) return t("noneLeft");
	if (named > room) return t("overLimit", { count: room });
	// A failed lookup or send says why first: the entries it didn't recognise matter less. A text that names no paper is a title.
	return problem || (named && invalid.length ? t("invalid", { values: invalid.slice(0, 3).join(" "), count: invalid.length }) : "");
}

/** The dialog's state: what is typed, the papers found and picked, and sending them. `first` is the paper it opened on. */
function useSuggestion(first: string, left: number | undefined) {
	const t = useTranslations("suggestPapers");
	const { mutate } = useSWRConfig();
	const [text, setText] = useState("");
	/** The text the last Find ran on: the same text finds nothing new. */
	const [foundFor, setFoundFor] = useState<string | null>(null);
	const [rows, setRows] = useState<Row[]>([]);
	const [firstLeftOut, setFirstLeftOut] = useState(false);
	const [sent, setSent] = useState<number | null>(null);
	const [sending, setSending] = useState(false);
	const [problem, setProblem] = useState("");
	const [requestId] = useState(() => crypto.randomUUID());
	// Each lookup moves this on, so one that comes back after the next started is dropped.
	const turn = useRef(0);
	// The paper the dialog opened on is the search row's, already read there, or read now after a sign-in.
	const opened = looked(first);
	const named = usePaperNamed(opened ? first : null);
	const firstRow: Row | null = !opened || firstLeftOut ? null : { ...opened, picked: true, state: named.data ? STATE_OF[named.data.outcome] : named.error ? "missing" : "looking", ...named.data?.paper };
	const all = firstRow ? [firstRow, ...rows.filter((row) => row.key !== firstRow.key)] : rows;
	const pastes = parse(text);
	// Nothing is looked up until the day's allowance is known, and no more than it is sent.
	const room = Math.min(left ?? 0, PER_REQUEST);
	const ready = all.filter((row) => row.state === "found" && row.picked).slice(0, room);
	const title = pastes.length ? "" : text.trim();
	const fail = (error: unknown) => setProblem(messageOf(error, t("failed")));

	/** The papers a paste names, each added to the list as it is found. */
	const findPasted = async (mine: number, kept: Row[]) => {
		const fresh = pastes.slice(0, room).filter((paper) => !kept.some((row) => row.key === paper.key) && paper.key !== firstRow?.key);
		setRows([...kept, ...fresh.map((paper): Row => ({ ...paper, state: "looking", picked: true }))]);
		if (!fresh.length) return;
		const { results } = await post<{ results: Answer[] }>({ preview: true, papers: fresh.map((paper) => paper.ref) });
		if (mine !== turn.current) return;
		const answers = new Map(fresh.map((paper, at) => [paper.key, results[at]]));
		setRows((current) => current.map((row) => (answers.has(row.key) ? { ...row, state: STATE_OF[answers.get(row.key)?.outcome ?? "not_found"], ...answers.get(row.key)?.paper } : row)));
	};
	/** The papers a title may name: each is added with its own button. */
	const findTitle = async (mine: number, kept: Row[]) => {
		setRows([...kept, { key: "title", raw: title, ref: {}, state: "looking", picked: false }]);
		const { matches } = await post<{ matches: (Answer & { ref: Reference })[] }>({ search: title });
		if (mine !== turn.current) return;
		const found = matches.map((match): Row => ({ key: `work:${match.ref.openalexId}`, raw: title, ref: match.ref, state: STATE_OF[match.outcome], picked: false, ...match.paper }));
		setRows([...kept, ...found.filter((row) => !kept.some((held) => held.key === row.key) && row.key !== firstRow?.key)]);
		if (!found.length) setProblem(t("noMatches"));
	};

	return {
		text, rows: all, sent, sending, problem, room, ready, named: pastes.length,
		invalid: unnamed(text),
		canFind: left !== 0 && foundFor !== text && (pastes.length > 0 || title.length >= TITLE_MIN),
		looking: all.some((row) => row.state === "looking"),
		type: setText,
		add: (key: string) => setRows((current) => current.map((row) => (row.key === key ? { ...row, picked: true } : row))),
		leaveOut: (key: string) => (key === firstRow?.key ? setFirstLeftOut(true) : setRows((current) => current.filter((row) => row.key !== key))),
		find: async () => {
			const mine = ++turn.current;
			setProblem("");
			setFoundFor(text);
			// What is picked stays; what the last search found and wasn't picked makes room for this one's.
			const kept = rows.filter((row) => row.picked && row.state !== "looking");
			try {
				await (pastes.length ? findPasted(mine, kept) : findTitle(mine, kept));
			} catch (error) {
				if (mine !== turn.current) return;
				setRows(kept);
				setFoundFor(null);
				fail(error);
			}
		},
		send: async () => {
			// A dialog closed or changed while this was on its way doesn't take its answer.
			const mine = ++turn.current;
			setSending(true);
			setProblem("");
			try {
				const { results } = await post<{ results: Sent[] }>({ requestId, papers: ready.map((row) => row.ref) });
				void mutate(LEFT_KEY);
				void mutate((key) => Array.isArray(key) && key[0] === "paper-named");
				if (mine !== turn.current) return;
				const failures = results.filter((result) => result.outcome === "failed");
				if (!failures.length) return setSent(results.filter((result) => result.outcome === "queued").length);
				// Some didn't go: the ones that did now wait for review, and the rest stay here to send again, with why.
				const waiting = new Set(ready.filter((_, at) => results[at]?.outcome !== "failed").map((row) => row.key));
				setRows((current) => current.map((row) => (waiting.has(row.key) ? { ...row, state: "waiting" } : row)));
				setProblem(failures[0]?.message ?? t("failed"));
			} catch (error) {
				if (mine === turn.current) fail(error);
			} finally {
				setSending(false);
			}
		},
	};
}

/** The field for a title or a paste, the day's limit or what went wrong beside Find papers, and the papers found. */
function FindPanel({ suggestion, left }: { suggestion: ReturnType<typeof useSuggestion>; left: number | undefined }) {
	const t = useTranslations("suggestPapers");
	const { rows } = suggestion;
	const find = () => void suggestion.find();
	return (
		<>
			<Textarea
				autoFocus
				aria-label={t("inputLabel")}
				placeholder={t("placeholder")}
				minRows={2}
				maxRows={8}
				isDisabled={left === 0}
				value={suggestion.text}
				onValueChange={suggestion.type}
				// Enter finds, as in a search box; Shift and Enter starts another line of a list.
				onKeyDown={(event) => {
					if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
					event.preventDefault();
					if (suggestion.canFind) find();
				}}
			/>
			<div className="flex min-h-8 items-center justify-between gap-3">
				<span className="text-sm text-warning-600 dark:text-warning">{hintOf(t, left, suggestion.named, suggestion.room, suggestion.problem, suggestion.invalid)}</span>
				<Button className="shrink-0" size="sm" variant="bordered" isDisabled={!suggestion.canFind} onPress={find} startContent={<HugeiconsIcon icon={Search01Icon} className="size-4" aria-hidden />}>
					{t("find")}
				</Button>
			</div>
			<ul aria-label={t("resultsLabel")} className={`max-h-[calc(5*4.5rem+4px)] shrink-0 divide-y divide-black/10 overflow-y-auto rounded-xl border-black/10 transition-[border-width] dark:divide-white/10 dark:border-white/10 ${rows.length ? "border" : "border-0"}`}>
				<AnimatePresence initial={false}>
					{rows.map((row) => <PaperRow key={row.key} row={row} onAdd={() => suggestion.add(row.key)} onLeaveOut={() => suggestion.leaveOut(row.key)} />)}
				</AnimatePresence>
			</ul>
		</>
	);
}

/** The dialog's inside, made when it opens: the paper it opened on is in the list from its first frame. */
function SuggestContent({ first, left, onClose }: { first: string; left: number | undefined; onClose: () => void }) {
	const t = useTranslations("suggestPapers");
	const suggestion = useSuggestion(first, left);
	const { sent, looking, ready } = suggestion;
	return (
		<>
			<ModalHeader className="flex flex-col gap-1">
				<span className="text-lg font-semibold">{t("title")}</span>
				<span className="text-sm font-normal text-foreground/60 dark:text-white/60">{t("description")}</span>
			</ModalHeader>
			<ModalBody>{sent !== null ? <SentPanel count={sent} /> : <FindPanel suggestion={suggestion} left={left} />}</ModalBody>
			<ModalFooter className="flex-wrap items-center justify-between gap-y-3">
				{sent !== null ? (
					<Button className="ms-auto" color="accent" variant="solid" onPress={onClose}>{t("done")}</Button>
				) : (
					<>
						<span className="whitespace-nowrap text-sm tabular-nums text-foreground/60 dark:text-white/60">{suggestion.rows.length && !looking ? t("toSuggest", { count: ready.length }) : null}</span>
						<span className="ms-auto flex gap-2">
							<Button variant="light" onPress={onClose}>{t("cancel")}</Button>
							<Button color="accent" variant="solid" isDisabled={looking || !ready.length} isLoading={suggestion.sending} onPress={() => void suggestion.send()} startContent={suggestion.sending ? null : <HugeiconsIcon icon={InboxIcon} className="size-4" aria-hidden />}>
								{t("send")}
							</Button>
						</span>
					</>
				)}
			</ModalFooter>
		</>
	);
}

/**
 * Suggest papers to this community: a signed-in reader finds papers by title, or pastes links, DOIs or OpenAlex IDs,
 * sees what they are, and sends them to the community's review queue (OpenDevEd/new-el#777). The team reviews each
 * before it goes live; the reader follows them in Openscholar's Your submissions.
 *
 * It is open while the address says so (`?suggest`, or `?suggest=<paper>` to open on one): a sign-in started from a
 * Suggest button comes back to that address, so the dialog is open when the page returns.
 */
export function SuggestPapersDialog() {
	const { reader } = useReaderSession();
	const [paper, setPaper] = useQueryState(SUGGEST_PARAM, parseAsString);
	const left = useLeft(Boolean(reader)).data;
	// A window event, so the reader's menu and every Suggest button open the same dialog.
	useEffect(() => {
		const show = (event: Event) => void setPaper((event as CustomEvent<string>).detail);
		window.addEventListener(OPEN_EVENT, show);
		return () => window.removeEventListener(OPEN_EVENT, show);
	}, [setPaper]);
	if (!reader) return null;
	const close = () => void setPaper(null);
	return (
		<DialogModal isOpen={paper !== null} onOpenChange={(next) => { if (!next) close(); }} size="3xl" scrollBehavior="inside">
			<ModalContent>
				<SuggestContent first={paper ?? ""} left={left} onClose={close} />
			</ModalContent>
		</DialogModal>
	);
}

/** The button that suggests papers, as the search's own buttons are drawn. Gone where the community has no reader accounts. */
export function SuggestButton({ centred = false }: { centred?: boolean }) {
	const t = useTranslations("suggestPapers");
	const suggest = useSuggest();
	if (!useLibraryFeature("readerAccounts")) return null;
	const icon = <HugeiconsIcon icon={InboxIcon} className={centred ? "size-5" : "size-6"} aria-hidden />;
	return (
		<Button onPress={() => suggest()} {...(centred ? { startContent: icon, color: "accent" as const, variant: "solid" as const } : { endContent: icon })}>
			{t("title")}
		</Button>
	);
}

/** Under a search that found nothing: a paper that isn't here can be suggested. */
export function SuggestEmpty() {
	const t = useTranslations("suggestPapers");
	if (!useLibraryFeature("readerAccounts")) return null;
	return (
		<span className="mt-4 flex flex-col items-center gap-3">
			<span>{t("emptyQuestion")}</span>
			<SuggestButton centred />
		</span>
	);
}

/**
 * Above a search's results when the search itself names a paper (a DOI, an OpenAlex ID or a paper's link): what the
 * paper is, and either where it is here or a button that suggests it. The row has its room from the first frame;
 * the paper's name fades into it once read.
 */
export function PaperNamed({ search }: { search: string }) {
	const t = useTranslations("suggestPapers");
	const suggest = useSuggest();
	const raw = search.trim();
	const offered = useLibraryFeature("readerAccounts") && namesPaper(raw);
	const { data, error } = usePaperNamed(offered ? raw : null);
	const state = data ? STATE_OF[data.outcome] : error ? "missing" : "looking";
	return (
		<AnimatePresence initial={false}>
			{offered && (
				<motion.div key="paper" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
					<div className="flex min-h-[4.75rem] flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3 sm:flex-nowrap">
						<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
							<HugeiconsIcon icon={File01Icon} className="size-6" aria-hidden />
						</span>
						<div className="min-w-0 flex-1 basis-48">
							<p className="line-clamp-2 font-medium sm:line-clamp-1">{data?.paper?.title ?? <span className="break-all font-mono text-sm">{raw}</span>}</p>
							<p className="flex min-w-0 gap-2 text-sm text-foreground/60 dark:text-white/60">
								{state === "looking" ? <span>{t("lookingUp")}</span> : state === "missing" ? <span>{t("noPaperNamed")}</span> : (
									<>
										<span className="truncate">{data?.paper?.authors || t("noAuthors")}</span>
										{data?.paper?.year ? <span className="shrink-0 tabular-nums">{data.paper.year}</span> : null}
									</>
								)}
							</p>
						</div>
						<span className="flex h-10 w-full shrink-0 items-center gap-2 sm:w-auto">
							{/* The button holds its place while the paper is read, so nothing arrives beside the title. */}
							{state === "found" || state === "looking" ? (
								<Button color="accent" variant="solid" className="flex-1 sm:flex-none" isDisabled={state === "looking"} onPress={() => suggest(raw)} startContent={state === "looking" ? <Spinner size="sm" color="current" /> : <HugeiconsIcon icon={InboxIcon} className="size-5" aria-hidden />}>
									{t("suggestThis")}
								</Button>
							) : null}
							{state === "waiting" ? <Chip variant="flat" startContent={<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" aria-hidden />}>{t("waiting")}</Chip> : null}
							{state === "here" ? (
								<>
									<Chip variant="flat" startContent={<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" aria-hidden />}>{t("inCommunity")}</Chip>
									{data?.itemKey ? <Button as={Link} href={`/lib/${data.itemKey}`} variant="bordered">{t("open")}</Button> : null}
								</>
							) : null}
						</span>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
