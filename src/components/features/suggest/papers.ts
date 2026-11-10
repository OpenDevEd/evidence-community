import { paperLinkKey, paperLinkOf } from "@/lib/paper-links";

/** Papers one request looks up or sends at most, as the community takes them. */
export const PER_REQUEST = 100;
/** The shortest title worth searching for. */
export const TITLE_MIN = 3;

type Reference = { openalexId?: string; doi?: string; link?: string };
type Looked = { key: string; raw: string; ref: Reference };
type Paper = { title: string; authors: string; year: number | null; openalexId?: string | null; doi?: string | null };
/** What the community says of one paper: whether it found it, and where it stands here. */
export type Answer = { outcome: "found" | "existing" | "queued" | "returned" | "not_found"; itemKey?: string; paper?: Paper };
/** A paper in the dialog's lists: new here (`found`), already here, waiting for review, or not found. */
export type Row = Looked & { state: "found" | "here" | "waiting" | "missing"; title?: string; authors?: string; year?: number | null };

/** A link, DOI or ID as the community's lookups take it. A link only Openscholar can follow goes as given, which asks it. */
function looked(raw: string): Looked | null {
	const link = paperLinkOf(raw);
	const key = link ? paperLinkKey(link) : null;
	if (!link || !key) return null;
	if (link.kind === "work") return { key, raw, ref: { openalexId: link.openalexId } };
	return { key, raw, ref: link.kind === "doi" ? { doi: link.doi } : { link: raw } };
}

/** The papers a paste names: DOIs, OpenAlex IDs and every address that names one, Openscholar's and communities' included; each once. */
export function parse(text: string): Looked[] {
	const named = text.split(/\s+/u).flatMap((raw) => looked(raw) ?? []);
	return named.filter((paper, at) => named.findIndex((other) => other.key === paper.key) === at);
}

/** Whether a search is nothing but one paper's link, DOI or ID. */
export const namesPaper = (search: string) => !/\s/u.test(search.trim()) && looked(search.trim()) !== null;

/** What a paste holds that names no paper, said back so the reader knows what was left out. */
export const unnamed = (text: string) => text.split(/\s+/u).filter((raw) => raw && !paperLinkOf(raw));

/** Where a paper looked up stands: new here (or returned before, so it can be sent again), already here, waiting, or not found. */
export const STATE_OF: Record<Answer["outcome"], Row["state"]> = { found: "found", returned: "found", existing: "here", queued: "waiting", not_found: "missing" };

/** Asks the community; the refusal it gives, if any, is the error's message. */
export async function call<T>(query = "", init?: RequestInit): Promise<T> {
	const response = await fetch(`/api/reader/papers${query}`, { ...init, headers: { "Content-Type": "application/json" } });
	const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!response.ok || !body) throw new Error(body?.error ?? "");
	return body;
}

export const post = <T,>(body: object) => call<T>("", { method: "POST", body: JSON.stringify(body) });

/**
 * Why a request failed, in words to show. One that never reached the community fails as a TypeError whose words are
 * the browser's ("Load failed", "Failed to fetch"): it says `fallback` instead. Any other is the community's own words.
 */
export function messageOf(error: unknown, fallback: string) {
	if (!(error instanceof Error) || error instanceof TypeError) return fallback;
	return error.message || fallback;
}

/** A paper is known by its work once found, so its DOI, its ID and a title that finds it are one row. */
const keyOf = (answer: Answer | undefined, otherwise: string) => (answer?.paper?.openalexId ? `work:${answer.paper.openalexId}` : otherwise);

const rowOf = (paper: Looked, answer: Answer | undefined): Row => ({ ...paper, key: keyOf(answer, paper.key), state: STATE_OF[answer?.outcome ?? "not_found"], ...answer?.paper });

/** The papers a paste names, each with where it stands here; one named twice is one row. */
async function namedPapers(pasted: Looked[]): Promise<Row[]> {
	const { results } = await post<{ results: Answer[] }>({ preview: true, papers: pasted.map((paper) => paper.ref) });
	const rows = pasted.map((paper, at) => rowOf(paper, results[at]));
	return rows.filter((row, at) => rows.findIndex((other) => other.key === row.key) === at);
}

/** The papers a title may name, as Openscholar's search finds them. */
async function titledPapers(title: string): Promise<Row[]> {
	const { matches } = await post<{ matches: (Answer & { ref: Reference })[] }>({ search: title });
	return matches.map((match) => rowOf({ key: `doi:${match.ref.doi}`, raw: title, ref: match.ref }, match));
}

/** What a search finds: the papers a paste names (`named`), no more than `room` of them, or the papers a title may name. */
export async function findPapers(query: string, room: number): Promise<{ named: boolean; rows: Row[] }> {
	const pasted = parse(query).slice(0, room);
	return pasted.length ? { named: true, rows: await namedPapers(pasted) } : { named: false, rows: await titledPapers(query) };
}
