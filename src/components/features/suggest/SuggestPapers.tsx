"use client";

import { useEffect, useState } from "react";
import { ModalBody, ModalContent, ModalFooter, ModalHeader, Chip } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { Add01Icon, ArrowUpRight01Icon, Cancel01Icon, CheckmarkCircle02Icon, File01Icon, InboxIcon, Search01Icon, TaskAdd01Icon } from "@hugeicons/core-free-icons";
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
import { useDebouncedValue } from "@/hooks/useDebounce";
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
type Row = Looked & { state: "looking" | "found" | "here" | "waiting" | "missing"; title?: string; authors?: string; year?: number | null };
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

const rowMotion = { initial: { height: 0, opacity: 0 }, animate: { height: "4.25rem", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: 0.2 } };

/** One paper: what it is, with what can be done with it at its end. */
function PaperRow({ row, picked = false, children }: { row: Row; picked?: boolean; children: React.ReactNode }) {
	const t = useTranslations("suggestPapers");
	const known = row.state === "here" || row.state === "waiting";
	return (
		<motion.li {...rowMotion} className="overflow-hidden">
			<div className="flex h-[4.25rem] items-center gap-3 rounded-xl px-3 hover:bg-black/[3%] dark:hover:bg-white/[4%]">
				<span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${picked ? "bg-accent/15 text-accent" : "bg-black/5 text-foreground/50 dark:bg-white/5 dark:text-white/50"}`}>
					{row.state === "looking" ? <Spinner size="sm" /> : <HugeiconsIcon icon={picked ? CheckmarkCircle02Icon : File01Icon} className="size-5" aria-hidden />}
				</span>
				<div className={`min-w-0 flex-1 ${known ? "opacity-60" : ""}`}>
					<p className="line-clamp-1 text-sm/5 font-medium">{row.title ?? <span className="font-mono text-xs">{row.raw}</span>}</p>
					{row.title ? (
						<p className="flex min-w-0 gap-2 text-xs/5 text-foreground/60 dark:text-white/60">
							<span className="truncate">{row.authors || t("noAuthors")}</span>
							{row.year ? <span className="shrink-0 tabular-nums">{row.year}</span> : null}
						</p>
					) : null}
				</div>
				{children}
			</div>
		</motion.li>
	);
}

/** What a paper the search found offers: adding it, taking it back out, or where it already stands here. */
function FoundEnd({ row, picked, onAdd, onRemove }: { row: Row; picked: boolean; onAdd: () => void; onRemove: () => void }) {
	const t = useTranslations("suggestPapers");
	if (row.state === "here" || row.state === "waiting")
		return (
			<Chip size="sm" variant="flat" startContent={<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" aria-hidden />}>
				{row.state === "here" ? t("alreadyHere") : t("waiting")}
			</Chip>
		);
	if (row.state === "missing") return <Chip size="sm" variant="flat" color="danger">{t("notFound")}</Chip>;
	if (row.state !== "found") return null;
	// One button in one place: Add, and once added, the same button takes it back out.
	return (
		<Button size="sm" variant={picked ? "flat" : "bordered"} color={picked ? "accent" : "default"} className="w-24 shrink-0" aria-label={t(picked ? "leaveOut" : "addTitle", { title: row.title ?? row.raw })} onPress={picked ? onRemove : onAdd} startContent={<HugeiconsIcon icon={picked ? CheckmarkCircle02Icon : Add01Icon} className="size-4" aria-hidden />}>
			{t(picked ? "added" : "add")}
		</Button>
	);
}

/** Said once the papers are sent: how many, and where the reader follows them. */
function SentPanel({ count }: { count: number }) {
	const t = useTranslations("suggestPapers");
	const openScholar = useOpenScholarUrl();
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
			<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-10 text-success" aria-hidden />
			<p className="text-base font-medium">{t("sent", { count })}</p>
			<p className="max-w-sm text-sm text-foreground/60 dark:text-white/60">{t("sentHint")}</p>
			<Button as="a" href={openScholar("/evidence-communities?view=submissions")} target="_blank" rel="noopener noreferrer" size="sm" variant="bordered" endContent={<HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4" aria-hidden />}>
				{t("yourSubmissions")}
			</Button>
		</div>
	);
}

/** What a search finds: the papers a paste names (`named`), each with where it stands here, or the papers a title may name. */
async function findPapers(query: string, room: number): Promise<{ named: boolean; rows: Row[] }> {
	const pasted = parse(query).slice(0, room);
	if (pasted.length) {
		const { results } = await post<{ results: Answer[] }>({ preview: true, papers: pasted.map((paper) => paper.ref) });
		return { named: true, rows: pasted.map((paper, at) => ({ ...paper, state: STATE_OF[results[at]?.outcome ?? "not_found"], ...results[at]?.paper })) };
	}
	const { matches } = await post<{ matches: (Answer & { ref: Reference })[] }>({ search: query });
	return { named: false, rows: matches.map((match) => ({ key: `work:${match.ref.openalexId}`, raw: query, ref: match.ref, state: STATE_OF[match.outcome], ...match.paper })) };
}

/** What the dialog says above its list when something needs saying: the day's limit, or why the last try failed. */
function noticeOf(t: ReturnType<typeof useTranslations<"suggestPapers">>, left: number | undefined, named: number, room: number, problem: string, invalid: string[]) {
	if (left === 0) return t("noneLeft");
	if (left !== undefined && named > room) return t("overLimit", { count: room });
	// A failed search or send says why first: the entries it didn't recognise matter less. A text that names no paper is a title.
	return problem || (named && invalid.length ? t("invalid", { values: invalid.slice(0, 3).join(" "), count: invalid.length }) : "");
}

/**
 * The dialog's state: what is typed, what it finds as the typing stops, the papers picked to send, and sending them.
 * `first` is the paper it opened on, picked from the start.
 */
function useSuggestion(first: string, left: number | undefined) {
	const t = useTranslations("suggestPapers");
	const { mutate } = useSWRConfig();
	const [text, setText] = useState("");
	const [picked, setPicked] = useState<Row[]>([]);
	const [firstLeftOut, setFirstLeftOut] = useState(false);
	const [sent, setSent] = useState<number | null>(null);
	const [sending, setSending] = useState(false);
	const [failure, setFailure] = useState("");
	const [requestId] = useState(() => crypto.randomUUID());
	// The paper the dialog opened on is the search row's, already read there, or read now after a sign-in.
	const opened = looked(first);
	const named = usePaperNamed(opened ? first : null);
	const firstRow: Row | null = !opened || firstLeftOut ? null : { ...opened, state: named.data ? STATE_OF[named.data.outcome] : named.error ? "missing" : "looking", ...named.data?.paper };
	const basket = firstRow ? [firstRow, ...picked.filter((row) => row.key !== firstRow.key)] : picked;
	// Nothing is looked up until the day's allowance is known, and no more than it is sent.
	const room = Math.min(left ?? 0, PER_REQUEST);
	const ready = basket.filter((row) => row.state === "found").slice(0, room);
	const add = (rows: Row[]) => setPicked((current) => [...current, ...rows.filter((row) => row.state === "found" && !current.some((held) => held.key === row.key))]);
	// The search runs once the typing stops; the last answer stays, dimmed, until the next one is in.
	const query = useDebouncedValue(text.trim(), 350);
	const pastes = parse(query).length;
	const searchable = room > 0 && (pastes > 0 || query.length >= TITLE_MIN);
	const search = useSWR(searchable ? ["suggest-find", query, room] : null, () => findPapers(query, room), {
		keepPreviousData: true,
		revalidateOnFocus: false,
		// Papers named outright are what the reader means to send, so they are picked as they are found.
		onSuccess: (answer) => { if (answer.named) add(answer.rows); },
	});
	const typed = text.trim();
	const found = typed && searchable ? (search.data?.rows ?? []) : [];
	return {
		text, sent, sending, basket, ready, found, room,
		/** What the list shows is a pasted list's papers, not a title's matches. */
		pasted: Boolean(typed) && search.data?.named === true,
		type: setText,
		isPicked: (key: string) => basket.some((row) => row.key === key),
		/** The list still shows the answer to an earlier text. */
		stale: Boolean(typed) && (typed !== query || search.isValidating),
		/** A title that found nothing, said in the list's place. */
		noMatches: Boolean(typed) && typed === query && searchable && !pastes && !search.isValidating && search.data?.rows.length === 0,
		notice: noticeOf(t, left, pastes, room, failure || (search.error ? messageOf(search.error, t("failed")) : ""), unnamed(query)),
		add: (row: Row) => add([row]),
		remove: (key: string) => (key === firstRow?.key ? setFirstLeftOut(true) : setPicked((current) => current.filter((row) => row.key !== key))),
		send: async () => {
			setSending(true);
			setFailure("");
			try {
				const { results } = await post<{ results: Sent[] }>({ requestId, papers: ready.map((row) => row.ref) });
				void mutate(LEFT_KEY);
				void mutate((key) => Array.isArray(key) && (key[0] === "paper-named" || key[0] === "suggest-find"));
				const failures = results.filter((result) => result.outcome === "failed");
				if (!failures.length) return setSent(results.filter((result) => result.outcome === "queued").length);
				// Some didn't go: the ones that did leave the list, and the rest stay to send again, with why.
				const gone = new Set(ready.filter((_, at) => results[at]?.outcome !== "failed").map((row) => row.key));
				setPicked((current) => current.filter((row) => !gone.has(row.key)));
				if (firstRow && gone.has(firstRow.key)) setFirstLeftOut(true);
				setFailure(failures[0]?.message ?? t("failed"));
			} catch (error) {
				setFailure(messageOf(error, t("failed")));
			} finally {
				setSending(false);
			}
		},
	};
}

/** Before anything is typed or picked: the two things the box takes, side by side in the room the papers will fill. */
function EmptyHint() {
	const t = useTranslations("suggestPapers");
	const ways = [
		{ icon: Search01Icon, title: t("emptyTitle"), hint: t("emptyHint") },
		{ icon: TaskAdd01Icon, title: t("pasteTitle"), hint: t("pasteHint") },
	];
	return (
		<div className="grid h-full content-center gap-3 px-3 sm:grid-cols-2">
			{ways.map((way) => (
				<div key={way.title} className="flex flex-col items-center gap-1 rounded-2xl bg-black/[3%] px-4 py-6 text-center dark:bg-white/[4%]">
					<HugeiconsIcon icon={way.icon} className="mb-2 size-7 text-foreground/50 dark:text-white/50" aria-hidden />
					<p className="font-medium">{way.title}</p>
					<p className="text-sm text-foreground/60 dark:text-white/60">{way.hint}</p>
				</div>
			))}
		</div>
	);
}

/** A pasted list in one line: how many of its papers were added, are already here, wait for review, or weren't found. */
function PastedSummary({ rows, isPicked }: { rows: Row[]; isPicked: (key: string) => boolean }) {
	const t = useTranslations("suggestPapers");
	const count = (state: Row["state"]) => rows.filter((row) => row.state === state).length;
	const parts = [
		{ key: "added" as const, count: rows.filter((row) => row.state === "found" && isPicked(row.key)).length, classNames: { base: "bg-accent/15", content: "text-accent" } },
		{ key: "here" as const, count: count("here") },
		{ key: "waiting" as const, count: count("waiting") },
		{ key: "missing" as const, count: count("missing"), color: "danger" as const },
	].filter((part) => part.count > 0);
	return (
		<p className="flex flex-wrap gap-2 px-3 pb-2">
			{parts.map(({ key, count: papers, ...look }) => <Chip key={key} size="sm" variant="flat" {...look}>{t(`pasted.${key}`, { count: papers })}</Chip>)}
		</p>
	);
}

/** The papers the search found, then the ones picked to send, in a room that keeps its height. */
function PaperLists({ suggestion }: { suggestion: ReturnType<typeof useSuggestion> }) {
	const t = useTranslations("suggestPapers");
	const { basket, found } = suggestion;
	// A paper picked shows once, among the picked, unless the search is showing it now.
	const kept = basket.filter((row) => !found.some((match) => match.key === row.key));
	if (!found.length && !basket.length && !suggestion.noMatches && !suggestion.notice) return <EmptyHint />;
	return (
		<>
			{suggestion.notice ? <p className="px-3 pb-2 text-sm text-warning-600 dark:text-warning">{suggestion.notice}</p> : null}
			{suggestion.noMatches ? <p className="px-3 pb-2 text-sm text-foreground/60 dark:text-white/60">{t("noMatches")}</p> : null}
			{suggestion.pasted && found.length > 1 ? <PastedSummary rows={found} isPicked={suggestion.isPicked} /> : null}
			<ul aria-label={t("resultsLabel")} className={`transition-opacity duration-200 motion-reduce:transition-none ${suggestion.stale ? "opacity-50" : ""}`}>
				<AnimatePresence initial={false}>
					{found.map((row) => (
						<PaperRow key={row.key} row={row} picked={suggestion.isPicked(row.key)}>
							<FoundEnd row={row} picked={suggestion.isPicked(row.key)} onAdd={() => suggestion.add(row)} onRemove={() => suggestion.remove(row.key)} />
						</PaperRow>
					))}
				</AnimatePresence>
			</ul>
			<AnimatePresence initial={false}>
				{kept.length ? (
					<motion.p key="label" initial={{ height: 0, opacity: 0 }} animate={{ height: "2rem", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="flex items-end overflow-hidden px-3 text-xs font-medium text-foreground/50 dark:text-white/50">
						{t("toSuggestLabel")}
					</motion.p>
				) : null}
			</AnimatePresence>
			<ul aria-label={t("toSuggestLabel")}>
				<AnimatePresence initial={false}>
					{kept.map((row) => (
						<PaperRow key={row.key} row={row} picked={row.state === "found"}>
							{row.state === "found" || row.state === "looking" ? (
								<Button isIconOnly size="sm" variant="light" aria-label={t("leaveOut", { title: row.title ?? row.raw })} onPress={() => suggestion.remove(row.key)}>
									<HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
								</Button>
							) : (
								<FoundEnd row={row} picked={false} onAdd={() => {}} onRemove={() => {}} />
							)}
						</PaperRow>
					))}
				</AnimatePresence>
			</ul>
		</>
	);
}

/** The dialog's inside, made when it opens: the paper it opened on is in the list from its first frame. */
function SuggestContent({ first, left, onClose }: { first: string; left: number | undefined; onClose: () => void }) {
	const t = useTranslations("suggestPapers");
	const suggestion = useSuggestion(first, left);
	const { sent, ready } = suggestion;
	return (
		<>
			<ModalHeader className="flex flex-col gap-3 pb-3">
				<div>
					<p className="text-lg font-semibold">{t("title")}</p>
					<p className="text-sm font-normal text-foreground/60 dark:text-white/60">{t("description")}</p>
				</div>
				{sent === null ? (
					// One line for a title, growing to hold a pasted list with a paper on each line.
					<Textarea
						autoFocus
						isClearable
						isDisabled={left === 0}
						aria-label={t("inputLabel")}
						placeholder={t("placeholder")}
						minRows={1}
						maxRows={5}
						autoCorrect="off"
						value={suggestion.text}
						onValueChange={suggestion.type}
						onClear={() => suggestion.type("")}
						// The search runs as the typing stops, so Enter has nothing to do; a list's lines come from the paste.
						onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) event.preventDefault(); }}
						classNames={{ inputWrapper: "min-h-12 py-2.5", innerWrapper: "items-start gap-2", input: "py-0.5 text-base font-normal" }}
						startContent={suggestion.stale ? <Spinner size="sm" className="size-6 shrink-0" /> : <HugeiconsIcon icon={Search01Icon} aria-hidden className="size-6 shrink-0 text-black/60 dark:text-white/40" />}
					/>
				) : null}
			</ModalHeader>
			<ModalBody className="h-[min(21rem,50dvh)] flex-none gap-0 overflow-y-auto px-3 py-0">{sent !== null ? <SentPanel count={sent} /> : <PaperLists suggestion={suggestion} />}</ModalBody>
			<ModalFooter className="flex-wrap items-center justify-between gap-y-3">
				{sent !== null ? (
					<Button className="ms-auto" color="accent" variant="solid" onPress={onClose}>{t("done")}</Button>
				) : (
					<>
						<span className="whitespace-nowrap text-sm tabular-nums text-foreground/60 dark:text-white/60">{t("toSuggest", { count: ready.length })}</span>
						<span className="ms-auto flex gap-2">
							<Button variant="light" onPress={onClose}>{t("cancel")}</Button>
							<Button color="accent" variant="solid" isDisabled={!ready.length} isLoading={suggestion.sending} onPress={() => void suggestion.send()} startContent={suggestion.sending ? null : <HugeiconsIcon icon={InboxIcon} className="size-4" aria-hidden />}>
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
 * Suggest papers to this community: a signed-in reader searches by title, or pastes links, DOIs or OpenAlex IDs,
 * picks the papers, and sends them to the community's review queue (OpenDevEd/new-el#777). The team reviews each
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
		<DialogModal isOpen={paper !== null} onOpenChange={(next) => { if (!next) close(); }} size="2xl">
			<ModalContent>
				<SuggestContent first={paper ?? ""} left={left} onClose={close} />
			</ModalContent>
		</DialogModal>
	);
}

/**
 * The button that suggests papers, as the search's own buttons are drawn; `small` under a search that found nothing,
 * as the button under results that failed to load is. Gone where the community has no reader accounts.
 */
export function SuggestButton({ small = false }: { small?: boolean }) {
	const t = useTranslations("suggestPapers");
	const suggest = useSuggest();
	if (!useLibraryFeature("readerAccounts")) return null;
	const icon = <HugeiconsIcon icon={InboxIcon} className={small ? "size-4" : "size-6"} aria-hidden />;
	return (
		<Button onPress={() => suggest()} {...(small ? { size: "sm" as const, startContent: icon } : { endContent: icon })}>
			{t("title")}
		</Button>
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
					<div className="flex min-h-[4.75rem] flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-card_light px-4 py-3 dark:bg-card sm:flex-nowrap">
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
