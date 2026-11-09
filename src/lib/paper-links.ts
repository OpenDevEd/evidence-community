import { normalizeDoi } from "@/lib/doi";

/**
 * A paper as someone names it by pasting where they found it: an OpenAlex work, a DOI, a paper only Openscholar's
 * index has (`own`, an OS ID), or a record on an Evidence Community's site. Openscholar's paper pages, on any of its
 * addresses, name the work in their path; a community's record page is `/lib/<record key>`. The same as Openscholar's
 * lib/papers/paper-links.ts, which follows the ones only it can.
 */
export type PaperLink =
	| { kind: "work"; openalexId: string }
	| { kind: "doi"; doi: string }
	| { kind: "own"; work: string }
	| { kind: "record"; origin: string; itemKey: string };

/** Openscholar's addresses: openscholar.ai and every name under it. */
const OURS = /(^|\.)openscholar\.ai$/iu;
/** A paper page's path, in a workspace's address or not: /papers/W123/its-title or /o/team/papers/OS456. */
const PAPER_PATH = /^(?:\/o\/[^/]+)?\/papers\/((?:W|OS)\d+)(?:\/|$)/iu;
/** A community's record page: /lib/ABCD2345. */
const RECORD_PATH = /^\/lib\/([A-Z0-9]{8})(?:\/|$)/u;
const WORK = /^(?:https?:\/\/openalex\.org\/(?:works\/)?)?(W\d+)$/iu;
const OWN = /^(?:https?:\/\/openscholar\.ai\/|openscholar:)?(OS\d+)$/iu;

/** A DOI without what a sentence or list put after it: a comma, a full stop, an unopened bracket. */
function trimDoi(doi: string) {
	let trimmed = doi.replace(/[,;.]+$/u, "");
	while (trimmed.endsWith(")") && (trimmed.match(/\(/gu)?.length ?? 0) < (trimmed.match(/\)/gu)?.length ?? 0)) trimmed = trimmed.slice(0, -1);
	return trimmed;
}

function urlOf(given: string) {
	try {
		return new URL(given);
	} catch {
		return null;
	}
}

/** The paper a web address names: one of Openscholar's paper pages, or a community's record page. */
function paperAt(given: string): PaperLink | null {
	const url = urlOf(given);
	if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
	const page = OURS.test(url.hostname) ? url.pathname.match(PAPER_PATH)?.[1]?.toUpperCase() : undefined;
	if (page) return page.startsWith("W") ? { kind: "work", openalexId: page } : { kind: "own", work: page };
	const record = url.pathname.match(RECORD_PATH)?.[1];
	return record ? { kind: "record", origin: url.origin, itemKey: record } : null;
}

/** The paper one pasted word names, or null for anything else. */
export function paperLinkOf(raw: string): PaperLink | null {
	// What a sentence or list wraps an address in: brackets, quotes, and punctuation after it. A DOI keeps its own brackets (trimDoi).
	const given = raw.trim().replace(/^[<(["']+/u, "").replace(/[>)\]"'.,;:!?]+$/u, "");
	const work = given.match(WORK)?.[1];
	if (work) return { kind: "work", openalexId: work.toUpperCase() };
	const own = given.match(OWN)?.[1];
	if (own) return { kind: "own", work: own.toUpperCase() };
	const address = paperAt(given);
	if (address) return address;
	const doi = normalizeDoi(trimDoi(raw.match(/10\.\d{4,9}\/\S+/iu)?.[0] ?? ""));
	return doi ? { kind: "doi", doi } : null;
}

/** One key per paper a link names, so the same one pasted twice is looked up once. */
export function paperLinkKey(link: PaperLink) {
	if (link.kind === "work") return link.openalexId;
	if (link.kind === "doi") return `doi:${link.doi}`;
	return link.kind === "own" ? `own:${link.work}` : `record:${link.origin}/${link.itemKey}`;
}

/** A paper as Openscholar names it: its OpenAlex work, its DOI, or both. */
export type PaperIds = { openalexId: string | null; doi: string | null };
