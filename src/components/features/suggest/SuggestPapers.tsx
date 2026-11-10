"use client";

import { useEffect, useRef, useState } from "react";
import { ModalBody, ModalContent, ModalFooter, ModalHeader, Chip, ScrollShadow } from "@nextui-org/react";
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
import { call, findPapers, messageOf, parse, PER_REQUEST, post, TITLE_MAX, TITLE_MIN, unnamed, type Row } from "./papers";

type Translate = ReturnType<typeof useTranslations<"suggestPapers">>;
type Picks = ReturnType<typeof useBasket>;

const OPEN_EVENT = "suggest-papers:open";
/** What the page is searching for, if anything: the dialog starts from it, since that is what the reader was looking for. */
const searchedFor = () => new URLSearchParams(window.location.search).get("search") ?? "";

/**
 * Opens the dialog from anywhere on the page, for a signed-in reader. Its field starts with the text given (a title,
 * or a paper's link, DOI or ID), and otherwise with the page's own search.
 */
export const openSuggestPapers = (text?: unknown) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: typeof text === "string" ? text : searchedFor() }));

/**
 * What every Suggest button does: opens the dialog on the text given, or on the page's search. Someone signed out
 * signs in first and comes back to this page with the dialog open, as if they had been signed in when they pressed.
 */
export function useSuggest() {
	const { reader, signInToSuggest } = useReaderSession();
	return (text?: string) => (reader ? void openSuggestPapers(text) : signInToSuggest(text ?? searchedFor()));
}

/** How many more papers the reader may suggest here today, read while they are signed in so the dialog opens knowing it. */
const LEFT_KEY = "suggest-papers-left";
const useLeft = () => useSWR(LEFT_KEY, () => call<{ left: number }>().then(({ left }) => left));
/** The day's allowance as the dialog takes it: how many are left once known, and whether it couldn't be read, which is tried again by itself. */
type Allowance = { left: number | undefined; failed: boolean };

/** A paper's name: its title, or what was pasted for it when nothing was found. */
const nameOf = (row: Row) => row.title ?? row.raw;

// A row fades in where it stands, so a whole answer arriving moves nothing; one taken out closes its place.
const rowMotion = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: 0.2 } };

/** A paper's authors and year, under its title. */
function RowDetail({ row }: { row: Row }) {
	const t = useTranslations("suggestPapers");
	return (
		<p className="flex min-w-0 gap-2 text-xs/5 text-foreground/60 dark:text-white/60">
			<span className="truncate">{row.authors || t("noAuthors")}</span>
			{row.year ? <span className="shrink-0 tabular-nums">{row.year}</span> : null}
		</p>
	);
}

/** One paper: what it is, with what can be done with it at its end. `picked` marks one that goes with the next send. */
function PaperRow({ row, picked = false, children }: { row: Row; picked?: boolean; children: React.ReactNode }) {
	// One that can't be suggested (already here, waiting, not found) stands back.
	const dimmed = row.state === "found" ? "" : "opacity-60";
	return (
		<motion.li {...rowMotion} className="h-[4.25rem] overflow-hidden">
			<div className="flex h-[4.25rem] items-center gap-3 rounded-xl px-3 hover:bg-black/[3%] dark:hover:bg-white/[4%]">
				<span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${picked ? "bg-accent/15 text-accent" : "bg-black/5 text-foreground/50 dark:bg-white/5 dark:text-white/50"}`}>
					<HugeiconsIcon icon={picked ? CheckmarkCircle02Icon : File01Icon} className="size-5" aria-hidden />
				</span>
				<div className={`min-w-0 flex-1 ${dimmed}`}>
					{/* On a phone the button leaves a title a few words: it takes the row's second line there. */}
					<p className="line-clamp-2 text-sm/5 font-medium sm:line-clamp-1">{row.title ?? <span dir="ltr" className="font-mono text-xs">{row.raw}</span>}</p>
					{row.title ? <RowDetail row={row} /> : null}
				</div>
				{children}
			</div>
		</motion.li>
	);
}

/** Where a paper that can't be suggested stands, said in a chip. */
const STANDING = {
	here: { label: "alreadyHere", color: "default" },
	waiting: { label: "waiting", color: "default" },
	missing: { label: "notFound", color: "danger" },
} as const;

function StandingChip({ state }: { state: keyof typeof STANDING }) {
	const t = useTranslations("suggestPapers");
	const { label, color } = STANDING[state];
	return <Chip size="sm" variant="flat" color={color}>{t(label)}</Chip>;
}

/** How the button that adds a paper reads before and after: one button in one place, which then takes the paper back out. */
const ADD = { variant: "bordered", color: "default", label: "add", says: "addTitle", icon: Add01Icon } as const;
const ADDED = { variant: "flat", color: "accent", label: "added", says: "leaveOut", icon: CheckmarkCircle02Icon } as const;

/** What a paper the search found offers: adding it, taking it back out, or where it already stands here. */
function FoundEnd({ row, picked, full, onAdd, onRemove }: { row: Row; picked: boolean; /** The day allows no more: one not picked can't be added. */ full: boolean; onAdd: () => void; onRemove: () => void }) {
	const t = useTranslations("suggestPapers");
	if (row.state !== "found") return <StandingChip state={row.state} />;
	const look = picked ? ADDED : ADD;
	return (
		<Button size="sm" variant={look.variant} color={look.color} className="w-24 shrink-0" aria-label={t(look.says, { title: nameOf(row) })} isDisabled={full && !picked} onPress={picked ? onRemove : onAdd} startContent={<HugeiconsIcon icon={look.icon} className="size-4" aria-hidden />}>
			{t(look.label)}
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
		{ key: "added" as const, count: rows.filter((row) => isPicked(row.key)).length, classNames: { base: "bg-accent/15", content: "text-accent" } },
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

/** Nothing picked yet, in a request of its own. */
const emptyBasket = () => ({ basket: [] as Row[], requestId: crypto.randomUUID(), failure: "" });

/**
 * The papers picked to send: added once each, only ones the community can take, and no more than `room`, what the day
 * still allows. With them, the request they go in and why its last try failed, so what a failed send left behind goes
 * again as the same request. Kept by the dialog's host, not its inside, so a dialog closed by mistake opens again with
 * all of it. Once every paper is gone, the next ones start a request of their own.
 */
function useBasket(room: number) {
	const [held, setHeld] = useState(emptyBasket);
	const fresh = (basket: Row[], rows: Row[]) => rows.filter((row) => row.state === "found" && !basket.some((other) => other.key === row.key));
	return {
		...held,
		add: (rows: Row[]) => setHeld((was) => ({ ...was, basket: [...was.basket, ...fresh(was.basket, rows).slice(0, Math.max(0, room - was.basket.length))] })),
		remove: (keys: string[]) => setHeld((was) => {
			const basket = was.basket.filter((row) => !keys.includes(row.key));
			return basket.length ? { ...was, basket } : emptyBasket();
		}),
		fail: (failure: string) => setHeld((was) => ({ ...was, failure })),
		/** A request that went whole is done with: what is still picked goes in the next. */
		renew: () => setHeld((was) => ({ ...emptyBasket(), basket: was.basket })),
	};
}

/** What a text asks for, as the day's allowance lets it: the papers it names, or the title it is, when it is long enough to be one. */
function askedBy(query: string, room: number) {
	const named = parse(query).length;
	const title = named === 0 && query.length >= TITLE_MIN;
	const tooLong = title && query.length > TITLE_MAX;
	return { named, tooLong, searchable: room > 0 && (named > 0 || (title && !tooLong)) };
}

/**
 * What the field's text finds, once the typing stops: the last answer stays, dimmed (`stale`), until the next one is
 * in. Papers named outright are what the reader means to send, so they are picked (`onNamed`) as they are found.
 */
function useFind(text: string, room: number, onNamed: (rows: Row[]) => void) {
	const typed = text.trim();
	const query = useDebouncedValue(typed, 350);
	const { named, tooLong, searchable } = askedBy(query, room);
	// What the field holds now, and the text whose papers were picked already. An answer to a text the reader has since
	// changed picks nothing; nor does the same text read again behind their back (after a send, on reconnecting), which
	// would put back a paper they took out. Typing (`retype`) makes the next answer pick.
	const held = useRef(typed);
	const pickedFor = useRef<string | null>(null);
	const pick = (answer: { named: boolean; rows: Row[]; query: string }) => {
		if (!answer.named || answer.query !== held.current || pickedFor.current === answer.query) return;
		pickedFor.current = answer.query;
		onNamed(answer.rows);
	};
	const search = useSWR(searchable ? ["suggest-find", query, room] : null, () => findPapers(query, room).then((answer) => ({ ...answer, query })), {
		keepPreviousData: true,
		revalidateOnFocus: false,
		// Asked again each time the same text comes back, never answered from a moment ago: `onSuccess` is what picks a paste's papers.
		dedupingInterval: 0,
		onSuccess: pick,
	});
	const settled = typed === query && !search.isValidating;
	const rows = typed && searchable ? (search.data?.rows ?? []) : [];
	return { query, named, tooLong, rows, settled, pasted: search.data?.named === true, error: search.error as unknown, retype: (value: string) => { held.current = value.trim(); pickedFor.current = null; } };
}

/** What the dialog says above its list when something needs saying: the day's limit, why the last try failed, or what a paste holds that names no paper. */
function noticeOf(t: Translate, find: ReturnType<typeof useFind>, { left, failed }: Allowance, room: number, failure: string) {
	if (failed) return t("failed");
	if (left === 0) return t("noneLeft");
	if (find.named > room) return t("overLimit", { count: room });
	if (failure) return failure;
	if (find.tooLong) return t("tooLong");
	if (find.error) return messageOf(find.error, t("failed"));
	const invalid = find.named ? unnamed(find.query) : [];
	return invalid.length ? t("invalid", { values: invalid.slice(0, 3).join(" "), count: invalid.length }) : "";
}

/** A paper the community didn't take: sending it failed, or it could no longer be found. It stays picked, with why. */
const stayed = (result: { outcome: string } | undefined) => result?.outcome === "failed" || result?.outcome === "not_found";

/**
 * Sending the picked papers, no more than `room` of them: the ones that went leave the list, and one that didn't
 * stays, with why. What a failed send left behind is sent again whole, whatever the day's allowance has become:
 * the community counted those papers when it took the request, and takes the same request again.
 */
function useSend({ basket, requestId, failure, remove, fail, renew }: Picks, room: number) {
	const t = useTranslations("suggestPapers");
	const { mutate } = useSWRConfig();
	const [sent, setSent] = useState<number | null>(null);
	const [sending, setSending] = useState(false);
	const ready = failure ? basket : basket.slice(0, room);
	const went = (results: { outcome: string; message?: string }[]) => {
		// Where each paper now stands is read again.
		void mutate((key) => Array.isArray(key) && String(key[0]).startsWith("suggest-"));
		const refused = results.find(stayed);
		remove(ready.filter((_, at) => !stayed(results[at])).map((row) => row.key));
		if (refused) return fail(refused.message ?? t("failed"));
		// What the day still allows is read again once everything went.
		void mutate(LEFT_KEY);
		renew();
		setSent(results.filter((result) => result.outcome === "queued").length);
	};
	const send = async () => {
		if (sending) return;
		setSending(true);
		fail("");
		await post<{ results: { outcome: string; message?: string }[] }>({ requestId, papers: ready.map((row) => row.ref) })
			.then(({ results }) => went(results), (error: unknown) => fail(messageOf(error, t("failed"))));
		setSending(false);
	};
	return { ready, sent, sending, send };
}

/**
 * The dialog's state: what is typed, what it finds, the papers picked to send, and sending them. `first` is the text
 * its field opens with: the page's search, or the paper a row offered.
 */
/** How many papers may be looked up, picked and sent: none until the day's allowance is known, and no more than it or one request holds. */
const roomOf = (left: number | undefined) => Math.min(left ?? 0, PER_REQUEST);

/** Whether the allowance is in, one way or the other: one that couldn't be read is an answer too, said in place of waiting on it. */
const allowanceIn = ({ left, failed }: Allowance) => left !== undefined || failed;

/** What the list has to say about the text typed, once its search and the day's allowance are both in. */
function listStateOf(typed: boolean, find: ReturnType<typeof useFind>, allowance: Allowance) {
	const answered = find.settled && allowanceIn(allowance);
	const nothing = !find.named && find.rows.length === 0 && !find.error;
	return {
		/** The list still shows the answer to an earlier text. */
		stale: typed && !answered,
		/** What the list shows is a pasted list's papers, with more than one to count. */
		summarised: find.pasted && find.rows.length > 1,
		/** A title that found nothing, said in the list's place. */
		noMatches: typed && answered && nothing,
	};
}

function useSuggestion(first: string, allowance: Allowance, picks: Picks) {
	const { basket, add, remove } = picks;
	const t = useTranslations("suggestPapers");
	const [text, setText] = useState(first);
	const room = roomOf(allowance.left);
	const find = useFind(text, room, add);
	const sending = useSend(picks, room);
	return {
		...sending, text, basket,
		...listStateOf(Boolean(text.trim()), find, allowance),
		/** The day allows no more than are picked already: nothing more is added. */
		full: room > 0 && basket.length >= room,
		found: find.rows,
		type: (value: string) => { find.retype(value); setText(value); },
		add: (row: Row) => add([row]),
		remove: (key: string) => remove([key]),
		isPicked: (key: string) => basket.some((row) => row.key === key),
		notice: noticeOf(t, find, allowance, room, picks.failure),
	};
}
type Suggestion = ReturnType<typeof useSuggestion>;

/** The papers the search found, each with its button; one answer takes the last one's place, row for row. */
function FoundList({ suggestion }: { suggestion: Suggestion }) {
	const t = useTranslations("suggestPapers");
	return (
		// Answers to an earlier text can't be picked while the next ones are on their way.
		<ul aria-label={t("resultsLabel")} inert={suggestion.stale} className={`transition-opacity duration-200 motion-reduce:transition-none ${suggestion.stale ? "opacity-50" : ""}`}>
			{suggestion.found.map((row) => (
				<PaperRow key={row.key} row={row} picked={suggestion.isPicked(row.key)}>
					<FoundEnd row={row} picked={suggestion.isPicked(row.key)} full={suggestion.full} onAdd={() => suggestion.add(row)} onRemove={() => suggestion.remove(row.key)} />
				</PaperRow>
			))}
		</ul>
	);
}

/** The papers picked to send that the search isn't showing now: a paper picked shows once. */
function Basket({ suggestion }: { suggestion: Suggestion }) {
	const t = useTranslations("suggestPapers");
	const kept = suggestion.basket.filter((row) => !suggestion.found.some((match) => match.key === row.key));
	if (!kept.length) return null;
	return (
		<>
			<motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="flex h-8 items-end px-3 text-xs font-medium text-foreground/50 dark:text-white/50">
				{t("toSuggestLabel")}
			</motion.p>
			<ul aria-label={t("toSuggestLabel")}>
				<AnimatePresence initial={false}>
					{kept.map((row) => (
						<PaperRow key={row.key} row={row} picked>
							<Button isIconOnly size="sm" variant="light" aria-label={t("leaveOut", { title: nameOf(row) })} onPress={() => suggestion.remove(row.key)}>
								<HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
							</Button>
						</PaperRow>
					))}
				</AnimatePresence>
			</ul>
		</>
	);
}

/** What the dialog has to say above its lists, when it has something: a warning, or that a title found nothing. */
function Notices({ suggestion }: { suggestion: Suggestion }) {
	const t = useTranslations("suggestPapers");
	return (
		<>
			{suggestion.notice ? <p className="px-3 pb-2 text-sm text-warning-600 dark:text-warning">{suggestion.notice}</p> : null}
			{suggestion.noMatches ? <p className="px-3 pb-2 text-sm text-foreground/60 dark:text-white/60">{t("noMatches")}</p> : null}
			{suggestion.full ? <p className="px-3 pb-2 text-sm text-foreground/60 dark:text-white/60">{t("basketFull", { count: suggestion.basket.length })}</p> : null}
			{suggestion.summarised ? <PastedSummary rows={suggestion.found} isPicked={suggestion.isPicked} /> : null}
		</>
	);
}

/** The papers the search found, then the ones picked to send, in a room that keeps its height. */
function PaperLists({ suggestion }: { suggestion: Suggestion }) {
	const idle = !suggestion.text.trim() && !suggestion.basket.length && !suggestion.notice;
	if (idle) return <EmptyHint />;
	return (
		<>
			<Notices suggestion={suggestion} />
			<FoundList suggestion={suggestion} />
			<Basket suggestion={suggestion} />
		</>
	);
}

/** The lines of a pasted list the field shows before it scrolls. */
const FIELD_ROWS = 5;
/** The field's fade over the lines scrolled out of sight: above, below, or both. */
const FIELD_FADE: Record<string, string> = {
	"true-false": "[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]",
	"false-true": "[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]",
	"true-true": "[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]",
	"false-false": "",
};

/** The search icon and the spinner share one place and fade into each other, so neither arrives at once. */
function FieldIcon({ busy }: { busy: boolean }) {
	const fade = "absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none";
	return (
		<span className="relative size-6 shrink-0">
			<HugeiconsIcon icon={Search01Icon} aria-hidden className={`${fade} size-6 text-black/60 dark:text-white/40 ${busy ? "opacity-0" : ""}`} />
			<span className={`${fade} flex items-center justify-center ${busy ? "" : "opacity-0"}`}>
				<Spinner size="sm" />
			</span>
		</span>
	);
}

/** One line for a title, growing to hold a pasted list with a paper on each line; a list longer than it fades at the end that has more. */
function FindField({ suggestion, disabled, onClose }: { suggestion: Suggestion; disabled: boolean; onClose: () => void }) {
	const t = useTranslations("suggestPapers");
	// Which ends of a long pasted list are out of the field's sight, as its own scrolling says.
	const [hidden, setHidden] = useState({ above: false, below: false });
	const fade = suggestion.text.split("\n").length > FIELD_ROWS ? FIELD_FADE[`${hidden.above}-${hidden.below}`] : "";
	return (
		<Textarea
			autoFocus
			isClearable
			isDisabled={disabled}
			aria-label={t("inputLabel")}
			placeholder={t("placeholder")}
			minRows={1}
			maxRows={FIELD_ROWS}
			autoCorrect="off"
			value={suggestion.text}
			onValueChange={suggestion.type}
			onClear={() => suggestion.type("")}
			onKeyDown={(event) => {
				// The field keeps Escape to itself otherwise, and the dialog would stay.
				if (event.key === "Escape") onClose();
				// The search runs as the typing stops, so Enter has nothing to do; a list's lines come from the paste.
				if (event.key === "Enter" && !event.shiftKey) event.preventDefault();
			}}
			onScroll={(event) => {
				const field = event.currentTarget;
				setHidden({ above: field.scrollTop > 1, below: field.scrollTop + field.clientHeight < field.scrollHeight - 1 });
			}}
			// The clear button sits on the first line, level with the search icon and as far from its own edge; the text
			// stops short of it. Each line reads the way its own script does (a DOI left to right in Arabic too, a title
			// in Arabic right to left in English), and starts on the page's side, beside the search icon.
			classNames={{ inputWrapper: "min-h-12 py-2.5", innerWrapper: "items-start gap-2", clearButton: "top-3.5 right-3.5 rtl:left-3.5", input: `py-0.5 pr-8 text-left text-base font-normal [unicode-bidi:plaintext] rtl:pl-8 rtl:pr-0 rtl:text-right ${fade}` }}
			startContent={<FieldIcon busy={suggestion.stale} />}
		/>
	);
}

/** How many papers go, and the buttons that send them or close the dialog. */
/** The button that sent the papers is gone once they went: the one that closes takes the focus, so Enter and Escape still answer. */
const focusOnMount = (button: unknown) => { if (button instanceof HTMLElement) button.focus(); };

function SendFooter({ suggestion, onClose }: { suggestion: Suggestion; onClose: () => void }) {
	const t = useTranslations("suggestPapers");
	const padded = "px-4 xl:px-4";
	if (suggestion.sent !== null) return <Button ref={focusOnMount} size="md" className={`ms-auto ${padded}`} color="accent" variant="solid" onPress={onClose}>{t("done")}</Button>;
	// While it sends the button is inert, not disabled: a disabled button drops the focus out of the dialog.
	const busy = suggestion.sending ? "pointer-events-none opacity-disabled" : "";
	return (
		<>
			<span role="status" className="whitespace-nowrap text-sm tabular-nums text-foreground/60 dark:text-white/60">{t("toSuggest", { count: suggestion.ready.length })}</span>
			<span className="ms-auto flex gap-2">
				<Button size="md" className={padded} variant="light" onPress={onClose}>{t("cancel")}</Button>
				<Button size="md" className={`${padded} xl:gap-2 ${busy}`} color="accent" variant="solid" isDisabled={!suggestion.ready.length} aria-busy={suggestion.sending} onPress={() => void suggestion.send()} startContent={suggestion.sending ? <Spinner size="sm" color="current" classNames={{ wrapper: "h-4 w-4" }} /> : <HugeiconsIcon icon={InboxIcon} className="size-4" aria-hidden />}>
					{t("send")}
				</Button>
			</span>
		</>
	);
}

/** The dialog's inside, made when it opens, with the text it opens on already in its field. */
function SuggestContent({ first, allowance, picks, onClose }: { first: string; allowance: Allowance; picks: Picks; onClose: () => void }) {
	const t = useTranslations("suggestPapers");
	const suggestion = useSuggestion(first, allowance, picks);
	const done = suggestion.sent !== null;
	return (
		<>
			{/* The same distance from the dialog's edge on every side: its top, its sides and under its buttons. */}
			<ModalHeader className="flex flex-col gap-3 px-4 pb-2 pt-4">
				<div>
					<p className="text-lg font-semibold">{t("title")}</p>
					<p className="text-sm font-normal text-foreground/60 dark:text-white/60">{t("description")}</p>
				</div>
				{done ? null : <FindField suggestion={suggestion} disabled={allowance.left === 0 || suggestion.sending} onClose={onClose} />}
			</ModalHeader>
			{/* Nothing is added or taken out while a send is on its way: what goes is what was picked. */}
			{/* The list gives way, down to a row, before the dialog outgrows a short window; past that the dialog itself scrolls. */}
			<ModalBody inert={suggestion.sending} className="h-[min(21rem,50dvh)] min-h-[4.25rem] flex-initial p-0">
				{/* Papers past the edge fade out under it, at whichever end has more. */}
				<ScrollShadow size={32} className="h-full px-1">{done ? <SentPanel count={suggestion.sent ?? 0} /> : <PaperLists suggestion={suggestion} />}</ScrollShadow>
			</ModalBody>
			<ModalFooter className="flex-wrap items-center justify-between gap-y-3 px-4 pb-4 pt-3">
				<SendFooter suggestion={suggestion} onClose={onClose} />
			</ModalFooter>
		</>
	);
}

/**
 * Suggest papers to this community: a signed-in reader searches by title, or pastes links, DOIs or OpenAlex IDs,
 * picks the papers, and sends them to the community's review queue (OpenDevEd/new-el#777). The team reviews each
 * before it goes live; the reader follows them in Openscholar's Your submissions.
 *
 * It is open while the address says so (`?suggest`, with the text its field starts on): a sign-in started from a
 * Suggest button comes back to that address, so the dialog is open when the page returns.
 */
export function SuggestPapersDialog() {
	const { reader } = useReaderSession();
	// What a reader picked is theirs: once the session is another reader's, here or from another tab, the dialog starts with nothing.
	return reader ? <ReaderSuggestDialog key={reader.id} /> : null;
}

function ReaderSuggestDialog() {
	const [text, setText] = useQueryState(SUGGEST_PARAM, parseAsString);
	const left = useLeft();
	const picks = useBasket(roomOf(left.data));
	// A window event, so the reader's menu and every Suggest button open the same dialog.
	useEffect(() => {
		const show = (event: Event) => void setText((event as CustomEvent<string>).detail);
		window.addEventListener(OPEN_EVENT, show);
		return () => window.removeEventListener(OPEN_EVENT, show);
	}, [setText]);
	const close = () => void setText(null);
	return (
		<DialogModal isOpen={text !== null} onOpenChange={(next) => { if (!next) close(); }} size="2xl" classNames={{ base: "max-h-[calc(100dvh-0.5rem)] overflow-y-auto" }}>
			<ModalContent>
				<SuggestContent first={text ?? ""} allowance={{ left: left.data, failed: Boolean(left.error) }} picks={picks} onClose={close} />
			</ModalContent>
		</DialogModal>
	);
}

/** How the button that suggests papers is drawn beside the search's own buttons, and `small` under a search that found nothing, as the button under results that failed to load is. */
const BESIDE_SEARCH = { size: "lg", icon: "size-6", at: "endContent" } as const;
const UNDER_EMPTY = { size: "sm", icon: "size-4", at: "startContent" } as const;

/** The button that suggests papers. Gone where the community has no reader accounts. */
export function SuggestButton({ small = false }: { small?: boolean }) {
	const t = useTranslations("suggestPapers");
	const suggest = useSuggest();
	const look = small ? UNDER_EMPTY : BESIDE_SEARCH;
	if (!useLibraryFeature("readerAccounts")) return null;
	return (
		<Button size={look.size} onPress={() => suggest()} {...{ [look.at]: <HugeiconsIcon icon={InboxIcon} className={look.icon} aria-hidden /> }}>
			{t("title")}
		</Button>
	);
}
