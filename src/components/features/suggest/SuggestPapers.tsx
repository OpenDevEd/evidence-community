"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ModalBody, ModalContent, ModalFooter, ModalHeader, Chip } from "@nextui-org/react";
import { Cancel01Icon, CheckmarkCircle02Icon, InboxIcon, Search01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import DialogModal from "@/components/nextui/DialogModal";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import { Spinner } from "@/components/nextui/Spinner";
import { useOpenScholarUrl, useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { paperLinkKey, paperLinkOf } from "@/lib/paper-links";

/** Opens the dialog from anywhere on the page: the reader's menu and an empty search both do. */
export const openSuggestPapers = () => window.dispatchEvent(new Event("suggest-papers:open"));

/** Papers one request looks up or sends at most, as the community takes them. */
const PER_REQUEST = 100;

type Reference = { openalexId?: string; doi?: string; link?: string };
type Looked = { key: string; raw: string; ref: Reference };
type Answer = { outcome: "found" | "existing" | "queued" | "returned" | "not_found"; paper?: { title: string; authors: string; year: number | null } };
type Row = Looked & { state: "looking" | "found" | "here" | "waiting" | "missing"; title?: string; authors?: string; year?: number | null };
type Sent = { outcome: string; message?: string };

/** The papers a paste names: DOIs, OpenAlex IDs and every address that names one, Openscholar's and communities' included; each once. */
function parse(text: string): Looked[] {
	const seen = new Set<string>();
	return text.split(/\s+/u).filter(Boolean).flatMap((raw) => {
		const link = paperLinkOf(raw);
		const key = link ? paperLinkKey(link) : null;
		if (!link || !key || seen.has(key)) return [];
		seen.add(key);
		// A link only Openscholar can follow goes to the server as given, which asks it.
		const ref = link.kind === "work" ? { openalexId: link.openalexId } : link.kind === "doi" ? { doi: link.doi } : { link: raw };
		return [{ key, raw, ref }];
	});
}

/** What a paste holds that names no paper, said back so the reader knows what was left out. */
const unnamed = (text: string) => text.split(/\s+/u).filter((raw) => raw && !paperLinkOf(raw));

/** Where a paper looked up stands: new here (or returned before, so it can be sent again), already here, waiting, or not found. */
const STATE_OF: Record<Answer["outcome"], Row["state"]> = { found: "found", returned: "found", existing: "here", queued: "waiting", not_found: "missing" };

/** Asks the community, as the signed-in reader; the refusal it gives, if any, is the error's message. */
async function call<T>(init?: RequestInit): Promise<T> {
	const response = await fetch("/api/reader/papers", { ...init, headers: { "Content-Type": "application/json" } });
	const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!response.ok || !body) throw new Error(body?.error ?? "");
	return body;
}

const post = <T,>(body: object) => call<T>({ method: "POST", body: JSON.stringify(body) });
// A request that never reached the community fails as a TypeError whose words are the browser's ("Load failed", "Failed
// to fetch"): it says it couldn't reach the community instead. Any other error is the community's own words.
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && !(error instanceof TypeError) && error.message ? error.message : fallback);

/** One paper looked up: what it is, and where it stands here, or a button to leave it out. */
function PaperRow({ row, onLeaveOut }: { row: Row; onLeaveOut: () => void }) {
	const t = useTranslations("suggestPapers");
	const known = row.state === "here" || row.state === "waiting";
	return (
		<li className={`flex h-14 items-center gap-3 px-3 ${known ? "opacity-60" : ""}`}>
			{row.state === "looking" ? <Spinner size="sm" /> : null}
			<div className="min-w-0 flex-1">
				<p className="line-clamp-2 text-sm/5 font-medium">{row.title ?? <span className="font-mono text-xs">{row.raw}</span>}</p>
				{row.title ? (
					<p className="flex min-w-0 gap-2 text-xs text-foreground/60 dark:text-white/60">
						<span className="truncate">{row.authors || t("noAuthors")}</span>
						{row.year ? <span className="shrink-0 tabular-nums">{row.year}</span> : null}
					</p>
				) : null}
			</div>
			<RowEnd row={row} onLeaveOut={onLeaveOut} />
		</li>
	);
}

/** Where a paper looked up stands here, or the button that leaves a new one out. */
function RowEnd({ row, onLeaveOut }: { row: Row; onLeaveOut: () => void }) {
	const t = useTranslations("suggestPapers");
	if (row.state === "here" || row.state === "waiting")
		return (
			<Chip size="sm" variant="flat" startContent={<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" aria-hidden />}>
				{row.state === "here" ? t("alreadyHere") : t("waiting")}
			</Chip>
		);
	if (row.state === "missing") return <Chip size="sm" variant="flat" color="danger">{t("notFound")}</Chip>;
	if (row.state !== "found") return null;
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

/** What the paste field says beside Find papers: the day's limit, or why the last try failed. */
function hintOf(t: ReturnType<typeof useTranslations<"suggestPapers">>, left: number | null, named: number, room: number, problem: string, invalid: string[]) {
	// Until the allowance is known, only why it couldn't be read.
	if (left === null) return problem;
	if (left === 0) return t("noneLeft");
	if (named > room) return t("overLimit", { count: room });
	// A failed lookup or send says why first: the entries it didn't recognise matter less.
	return problem || (invalid.length ? t("invalid", { values: invalid.slice(0, 3).join(" "), count: invalid.length }) : "");
}

/** The dialog's state: the paste, what it found, and sending it. */
function useSuggestion() {
	const [text, setText] = useState("");
	const [left, setLeft] = useState<number | null>(null);
	const [rows, setRows] = useState<Row[] | null>(null);
	const [sent, setSent] = useState<number | null>(null);
	const [sending, setSending] = useState(false);
	const [problem, setProblem] = useState("");
	const [requestId, setRequestId] = useState("");
	// Each paste, lookup and reset moves this on, so a lookup that comes back after its paste changed is dropped.
	const turn = useRef(0);
	/** A new request, with how many papers the reader may still suggest here today. Kept, so the dialog listens once. */
	const start = useCallback((failed: string) => {
		setRequestId(crypto.randomUUID());
		setLeft(null);
		void call<{ left: number }>().then(({ left }) => setLeft(left), (error: unknown) => setProblem(messageOf(error, failed)));
	}, []);
	const named = parse(text);
	// Nothing is looked up until the day's allowance is known, and no more than it is sent.
	const room = Math.min(left ?? 0, PER_REQUEST);
	const pasted = named.slice(0, room);
	const ready = (rows ?? []).filter((row) => row.state === "found").slice(0, room);
	return {
		text, left, rows, sent, sending, problem, named, room, pasted, ready,
		looking: rows?.some((row) => row.state === "looking") ?? false,
		start,
		type: (value: string) => {
			turn.current++;
			setText(value);
			setRows(null);
		},
		reset: () => {
			turn.current++;
			setText("");
			setRows(null);
			setSent(null);
			setProblem("");
		},
		leaveOut: (key: string) => setRows((all) => all?.filter((row) => row.key !== key) ?? all),
		find: async (failed: string) => {
			const mine = ++turn.current;
			setProblem("");
			setRows(pasted.map((paper) => ({ ...paper, state: "looking" })));
			try {
				const { results } = await post<{ results: Answer[] }>({ preview: true, papers: pasted.map((paper) => paper.ref) });
				if (mine === turn.current) setRows(pasted.map((paper, at) => ({ ...paper, state: STATE_OF[results[at]?.outcome ?? "not_found"], ...results[at]?.paper })));
			} catch (error) {
				if (mine !== turn.current) return;
				setRows(null);
				setProblem(messageOf(error, failed));
			}
		},
		send: async (failed: string) => {
			// A dialog closed or changed while this was on its way doesn't take its answer.
			const mine = ++turn.current;
			setSending(true);
			setProblem("");
			try {
				const { results } = await post<{ results: Sent[] }>({ requestId, papers: ready.map((row) => row.ref) });
				if (mine !== turn.current) return;
				const failures = results.filter((result) => result.outcome === "failed");
				if (!failures.length) return setSent(results.filter((result) => result.outcome === "queued").length);
				// Some didn't go: the ones that did now wait for review, and the rest stay here to send again, with why.
				const waiting = new Set(ready.filter((_, at) => results[at]?.outcome !== "failed").map((row) => row.key));
				setRows((all) => all?.map((row) => (waiting.has(row.key) ? { ...row, state: "waiting" } : row)) ?? all);
				setProblem(failures[0]?.message ?? failed);
			} catch (error) {
				if (mine === turn.current) setProblem(messageOf(error, failed));
			} finally {
				setSending(false);
			}
		},
	};
}

/** The paste, the day's limit or what went wrong beside Find papers, and the papers it found. */
function PastePanel({ suggestion }: { suggestion: ReturnType<typeof useSuggestion> }) {
	const t = useTranslations("suggestPapers");
	const { rows } = suggestion;
	return (
		<>
			<Textarea
				aria-label={t("inputLabel")}
				placeholder={"10.1016/j.tate.2015.06.010\nhttps://openalex.org/W2126314681"}
				minRows={4}
				maxRows={8}
				isDisabled={suggestion.left === 0}
				value={suggestion.text}
				onValueChange={suggestion.type}
				classNames={{ input: "font-mono text-xs" }}
			/>
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm text-warning-600 dark:text-warning">{hintOf(t, suggestion.left, suggestion.named.length, suggestion.room, suggestion.problem, unnamed(suggestion.text))}</span>
				<Button className="shrink-0" size="sm" variant="bordered" isDisabled={!suggestion.pasted.length || rows !== null} onPress={() => void suggestion.find(t("failed"))} startContent={<HugeiconsIcon icon={Search01Icon} className="size-4" aria-hidden />}>
					{t("find")}
				</Button>
			</div>
			{rows ? (
				<ul aria-label={t("resultsLabel")} className="max-h-[calc(6*3.5rem+5px)] shrink-0 divide-y overflow-y-auto divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
					{rows.map((row) => <PaperRow key={row.key} row={row} onLeaveOut={() => suggestion.leaveOut(row.key)} />)}
				</ul>
			) : null}
		</>
	);
}

/**
 * Suggest papers to this community: a signed-in reader pastes DOIs or OpenAlex IDs, sees what they are, and sends
 * them to the community's review queue (OpenDevEd/new-el#777). The team reviews each before it goes live; the reader
 * follows them in Openscholar's Your submissions. As many as the community takes from them today are looked up.
 */
export function SuggestPapersDialog() {
	const t = useTranslations("suggestPapers");
	const { reader } = useReaderSession();
	const [open, setOpen] = useState(false);
	const suggestion = useSuggestion();
	const { start } = suggestion;
	// A window event, so the reader's menu and an empty search open the same dialog.
	useEffect(() => {
		const show = () => {
			setOpen(true);
			start(t("failed"));
		};
		window.addEventListener("suggest-papers:open", show);
		return () => window.removeEventListener("suggest-papers:open", show);
	}, [start, t]);
	if (!reader) return null;
	const { rows, sent, looking, ready } = suggestion;
	const close = () => {
		setOpen(false);
		suggestion.reset();
	};

	return (
		<DialogModal isOpen={open} onOpenChange={(next) => (next ? setOpen(true) : close())} size="3xl" scrollBehavior="inside">
			<ModalContent>
				<ModalHeader className="flex flex-col gap-1">
					<span className="text-lg font-semibold">{t("title")}</span>
					<span className="text-sm font-normal text-foreground/60 dark:text-white/60">{t("description")}</span>
				</ModalHeader>
				<ModalBody>
					{sent !== null ? <SentPanel count={sent} /> : <PastePanel suggestion={suggestion} />}
				</ModalBody>
				<ModalFooter className="items-center justify-between">
					{sent !== null ? (
						<Button className="ms-auto" color="accent" variant="solid" onPress={close}>{t("done")}</Button>
					) : (
						<>
							<span className="text-sm text-foreground/60 dark:text-white/60 tabular-nums">{rows && !looking ? t("toSuggest", { count: ready.length }) : null}</span>
							<span className="flex gap-2">
								<Button variant="light" onPress={close}>{t("cancel")}</Button>
								<Button color="accent" variant="solid" isDisabled={!rows || looking || !ready.length} isLoading={suggestion.sending} onPress={() => void suggestion.send(t("failed"))} startContent={suggestion.sending ? null : <HugeiconsIcon icon={InboxIcon} className="size-4" aria-hidden />}>
									{t("send")}
								</Button>
							</span>
						</>
					)}
				</ModalFooter>
			</ModalContent>
		</DialogModal>
	);
}

/**
 * Under a search that found nothing: a paper that isn't here can be suggested. Someone signed out signs in with
 * Openscholar first.
 */
export function SuggestLink() {
	const t = useTranslations("suggestPapers");
	const { reader, signIn } = useReaderSession();
	if (!useLibraryFeature("readerAccounts")) return null;
	return (
		<span className="mt-2 block">
			<button type="button" onClick={reader ? openSuggestPapers : signIn} className="text-accent underline-offset-2 hover:underline">
				{t("emptyLink")}
			</button>
		</span>
	);
}
