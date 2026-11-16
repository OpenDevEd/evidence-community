import { itemDraft, itemIdentity } from "@opendeved/evidence-library-core";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { summaryOf, type PaperSummary } from "./paper-summary";
import { reserveItemIdentity } from "@/db/record-identity";
import { addedPaper } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { itemReview, itemReviewSender } from "@/db/schema/review";
import { itemSourceValue } from "@/db/schema/topics";
import { normalizeDoi } from "@/lib/doi";
import { paperLinkOf, type PaperIds } from "@/lib/paper-links";
import { papersAtLinks, reportsByDoi, type OpenscholarReport } from "@/lib/openscholar-service";
import { reportPayload } from "@/lib/source-ingestion/openscholar/report-record";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { OPENALEX_MAX_IDS_PER_FILTER, OpenAlexClient, worksWithIds } from "@/lib/source-ingestion/openalex/client";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { openAlexItemKeys } from "@/lib/source-ingestion/openalex/references";
import { requestSourceRun } from "@/lib/source-ingestion/run-requests";
import { searchZoteroIdentifier } from "@/lib/zotero-translation";

import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "./constants";
import { AdminValidationError } from "./errors";
import type { EvidenceFileStorage } from "./file-storage";
import { findExistingRecords, importIdentifiers, importPayloadFromZoteroItem } from "./item-import-service";
import { NativeItemValidationError, validateNativeItemDraft } from "./native-item-validation";
import { approveItemReview, submitItemReview } from "./review-service";

/** Papers one request adds at most. */
export const ADD_PAPERS_MAX = 100;

/** Papers one person outside the team suggests to the community a day, and all of them together (#777). */
export const SUGGESTIONS_PER_PERSON_DAY = 50;
const SUGGESTIONS_PER_COMMUNITY_DAY = 500;

/** The person as the review queue treats them: someone outside the team as a Creator. */
export const reviewerOf = (actor: Pick<AddPapersInput["actor"], "userId" | "role">) => ({ userId: actor.userId, role: actor.role === "reader" ? ("creator" as const) : actor.role });

/** How many more papers someone outside the team may suggest today; unlimited for the team. */
export async function suggestionsLeft(transaction: Database | DatabaseTransaction, actor: Pick<AddPapersInput["actor"], "userId" | "role">) {
	if (actor.role !== "reader") return Number.POSITIVE_INFINITY;
	const [counts] = await transaction
		.select({
			mine: sql<number>`count(*) FILTER (WHERE ${addedPaper.addedBy} = ${actor.userId})::int`,
			all: sql<number>`count(*)::int`,
		})
		.from(addedPaper)
		.where(sql`${addedPaper.suggested} AND ${addedPaper.addedAt} > now() - interval '1 day'`);
	return Math.min(SUGGESTIONS_PER_PERSON_DAY - (counts?.mine ?? 0), SUGGESTIONS_PER_COMMUNITY_DAY - (counts?.all ?? 0));
}

/** A paper by its OpenAlex work, its DOI, or a `link`: any address that names one (lib/paper-links.ts). */
export type PaperReference = { openalexId?: string | null; doi?: string | null; link?: string | null };

export type AddPapersInput = {
	/** OpenScholar's id for the request: sent again, it adds nothing twice. */
	requestId: string;
	/** Publish at once, which an owner or editor may; otherwise each paper waits in the review queue. */
	publish: boolean;
	/** A `reader` is anyone signed in outside the team: like a Creator, they only send papers to the review queue. */
	actor: { userId: string; name: string | null; email?: string | null; role: "owner" | "editor" | "creator" | "reader" };
	papers: PaperReference[];
};

/** A paper as a list of added papers shows it: its title, authors and year. */
type SentPaper = PaperSummary & { openalexId: string | null; doi: string | null };

export type AddedPaperResult = {
	/** The paper's place in the request. */
	at: number;
	/** `returned`: sent before, and its review was returned or withdrawn; sending it again is a new submission. */
	outcome: "added" | "queued" | "returned" | "existing" | "not_found" | "failed";
	itemKey?: string;
	/** How it was found: on OpenAlex, or only by its DOI, in which case each sync looks for it on OpenAlex again. */
	foundBy?: "openalex" | "doi";
	/** What was sent, for the sender's list of submissions: its title, authors, year, OpenAlex ID and DOI. */
	paper?: SentPaper;
	message?: string;
};

/** Where papers are looked up: OpenAlex by work or DOI, and the DOI lookup the admin import uses. */
export type PaperLookup = {
	worksById: (ids: readonly string[]) => Promise<Map<string, unknown>>;
	worksByDoi: (dois: readonly string[]) => Promise<Map<string, unknown>>;
	/** The record a DOI names, as a draft's payload, or null when there is none. */
	recordByDoi: (doi: string) => Promise<Record<string, unknown> | null>;
	/** The paper each link names that only Openscholar can follow, or null where it finds none. */
	papersAtLinks: (links: readonly string[]) => Promise<Array<PaperIds | null>>;
	/** The Openscholar Reports among these DOIs, by DOI: asked before OpenAlex, whose record a report's never becomes. */
	reportsByDoi: (dois: readonly string[]) => Promise<Map<string, OpenscholarReport>>;
};

const workOf = (id: string | null | undefined) => id?.trim().match(/(?:^|\/)(W[1-9]\d*)$/iu)?.[1]?.toUpperCase() ?? null;
/** The bare OpenAlex work (W2741809807) a work's `id` names, or null. */
export const workIdOf = (work: unknown) => workOf(String((work as { id?: unknown } | null)?.id ?? ""));
const chunks = <T,>(values: readonly T[]) => Array.from({ length: Math.ceil(values.length / OPENALEX_MAX_IDS_PER_FILTER) }, (_, at) => values.slice(at * OPENALEX_MAX_IDS_PER_FILTER, (at + 1) * OPENALEX_MAX_IDS_PER_FILTER));

/**
 * The lookups a running library uses: its own OpenAlex key, its Zotero translation service for DOIs, and Openscholar for
 * its own links, where a `reader`'s lookups count against their allowance.
 */
export function paperLookupFor(config: LibraryServerConfig, reader?: string): PaperLookup {
	const apiKey = config.services.openAlex?.apiKey;
	const client = apiKey ? new OpenAlexClient({ apiKey }) : null;
	const translationUrl = config.services.zotero.translationUrl;
	return {
		worksById: async (ids) => {
			const works = new Map<string, unknown>();
			if (!client) return works;
			for (const part of chunks(ids)) {
				for (const work of (await client.works(worksWithIds(part), "*", OPENALEX_MAX_IDS_PER_FILTER)).results) {
					const id = workIdOf(work);
					if (id) works.set(id, work);
				}
			}
			return works;
		},
		worksByDoi: async (dois) => {
			const works = new Map<string, unknown>();
			if (!client) return works;
			for (const part of chunks(dois)) for (const [doi, work] of await client.worksByDoi(part)) works.set(doi, work);
			return works;
		},
		recordByDoi: async (doi) => {
			if (!translationUrl) return null;
			const [found] = await searchZoteroIdentifier(doi, translationUrl);
			return found ? importPayloadFromZoteroItem(found) : null;
		},
		papersAtLinks: (links) => papersAtLinks(config.authentication.openScholar, links, reader),
		reportsByDoi: (dois) => reportsByDoi(config.authentication.openScholar, dois),
	};
}

/**
 * The papers given by a link, or by an ID that is one, as OpenAlex IDs and DOIs, by their place; a link Openscholar
 * finds nothing at is null. An OpenAlex link or DOI is read here; Openscholar's own pages, its index's papers and
 * communities' records are asked of it, all in one call.
 */
async function linkedPapers(papers: readonly PaperReference[], lookup: PaperLookup) {
	const linked = new Map<number, PaperIds | null>();
	const asked: { at: number; link: string }[] = [];
	papers.forEach((paper, at) => {
		const given = paper.link ?? (paper.openalexId && !workOf(paper.openalexId) ? paper.openalexId : null);
		if (!given) return;
		const link = paperLinkOf(given);
		if (!link) linked.set(at, null);
		else if (link.kind === "work") linked.set(at, { openalexId: link.openalexId, doi: paper.doi ?? null });
		else if (link.kind === "doi") linked.set(at, { openalexId: null, doi: link.doi });
		else asked.push({ at, link: given });
	});
	// Openscholar not answering is a failure to look up, said as one; only a link it finds nothing at is not found.
	const answers = await lookup.papersAtLinks(asked.map(({ link }) => link));
	asked.forEach(({ at }, index) => linked.set(at, answers[index] ?? null));
	return linked;
}

export type Found = { at: number; openalexId: string | null; doi: string | null; payload: Record<string, unknown>; remoteVersion?: string | null };

/** A draft's payload from an OpenAlex work: what the source's sync would write, so a reviewer sees the same record. */
function payloadOfWork(work: unknown) {
	const [parent] = mapOpenAlexWork(work).items;
	return parent!.metadata as Record<string, unknown>;
}

type Reference = { at: number; openalexId: string | null; doi: string | null };
export type Results = Map<number, AddedPaperResult>;
/** `again`: a paper waiting in the community, sent by another request, which submits it again if its review ended. */
type Made = { at: number; itemKey: string; foundBy: "openalex" | "doi"; again?: boolean };

/**
 * The papers that are Openscholar Reports, from Openscholar's own details, in one request (OpenDevEd/new-el#814): a
 * report is in neither OpenAlex nor the DOI lookup until its deposit is indexed. One withdrawn there isn't added.
 */
async function findOnOpenscholar(refs: readonly Reference[], lookup: PaperLookup, results: Results) {
	const dois = [...new Set(refs.flatMap((ref) => ref.doi ?? []))];
	const reports = dois.length ? await lookup.reportsByDoi(dois) : new Map<string, OpenscholarReport>();
	const found: Found[] = [];
	for (const ref of refs) {
		const report = ref.doi ? reports.get(ref.doi) : undefined;
		if (!report) continue;
		if (report.state === "withdrawn") results.set(ref.at, { at: ref.at, outcome: "not_found", message: "This report was withdrawn on Openscholar." });
		else found.push({ at: ref.at, openalexId: null, doi: ref.doi, payload: validateNativeItemDraft(reportPayload(report), { allowIncompleteCreators: true }).payload, remoteVersion: report.version });
	}
	return found;
}

/** Looks each paper up on OpenAlex, by work and then by DOI. Returns the ones found and the DOIs it didn't have. */
async function findOnOpenAlex(refs: readonly Reference[], lookup: PaperLookup, results: Results) {
	const byId = await lookup.worksById([...new Set(refs.flatMap((ref) => ref.openalexId ?? []))]);
	const byDoi = await lookup.worksByDoi([...new Set(refs.filter((ref) => !(ref.openalexId && byId.has(ref.openalexId)) && ref.doi).map((ref) => ref.doi!))]);
	const found: Found[] = [];
	const doiOnly: { at: number; doi: string }[] = [];
	for (const ref of refs) {
		const work = (ref.openalexId && byId.get(ref.openalexId)) || (ref.doi && byDoi.get(ref.doi));
		if (work) found.push({ at: ref.at, openalexId: workIdOf(work), doi: normalizeDoi((work as { doi?: string | null }).doi) ?? ref.doi, payload: payloadOfWork(work), remoteVersion: (work as { updated_date?: string | null }).updated_date ?? null });
		else if (ref.doi) doiOnly.push({ at: ref.at, doi: ref.doi });
		else results.set(ref.at, { at: ref.at, outcome: "not_found", message: "OpenAlex doesn't have this work." });
	}
	return { found, doiOnly };
}

/** The record a DOI on its own names, through the admin import's lookup, as a draft's payload. */
async function findByDoi(papers: readonly { at: number; doi: string }[], lookup: PaperLookup, results: Results) {
	const found: Found[] = [];
	for (const result of await mapWithConcurrency(papers, 4, async ({ at, doi }) => {
		try {
			const payload = await lookup.recordByDoi(doi);
			return payload ? { at, payload: validateNativeItemDraft(payload, { allowIncompleteCreators: true }).payload, doi } : { at, missing: "No record was found for this DOI." };
		} catch (error) {
			if (error instanceof NativeItemValidationError) return { at, missing: error.message };
			console.error("[added papers] DOI lookup failed", { doi, error: String(error) });
			return { at, missing: "The DOI lookup failed. Try again later." };
		}
	})) {
		if ("missing" in result) results.set(result.at, { at: result.at, outcome: "not_found", message: result.missing });
		else found.push({ at: result.at, openalexId: null, doi: result.doi, payload: result.payload });
	}
	return found;
}

type Known = { sent: (typeof addedPaper.$inferSelect)[]; gone: string[]; workKeys: Map<string, string>; existingDois: ReadonlyMap<string, string> };

/** Whether this request sent the paper: first, or again after its review was returned or withdrawn. */
const sentBy = (row: typeof addedPaper.$inferSelect, requestId: string) => row.requestId === requestId || row.resendRequestIds.includes(requestId);

/**
 * What to answer for a paper the community already has: accepted before (the same answer to the same request), or
 * already one of its records. Null for a paper new to it.
 */
function knownPaper(paper: Found, known: Known, requestId: string): AddedPaperResult | null {
	const sent = known.sent.find((row) => (paper.openalexId && row.openalexId === paper.openalexId) || (paper.doi && row.doi === paper.doi));
	if (sent) {
		const outcome = sentBy(sent, requestId) ? "added" : "existing";
		return { at: paper.at, outcome, itemKey: sent.itemKey, foundBy: sent.openalexId ? "openalex" : "doi" };
	}
	const here = (paper.openalexId && known.workKeys.get(paper.openalexId)) || (paper.doi && known.existingDois.get(paper.doi));
	return here ? { at: paper.at, outcome: "existing", itemKey: here } : null;
}

/** A new record of the Added papers source for one paper: its draft, and the row that waits for its review. */
async function createRecord(transaction: DatabaseTransaction, paper: Found, input: AddPapersInput): Promise<Made> {
	// Under its own key, not its work's: other OpenAlex sources match records by work, and one still waiting for review
	// must not be theirs to publish. Approval links it to its work.
	const itemKey = await reserveItemIdentity(transaction, { sourceConnectionKey: ADDED_PAPERS_SOURCE_CONNECTION_KEY });
	await transaction.update(itemIdentity).set({ kind: "imported", importMethod: "doi" }).where(eq(itemIdentity.key, itemKey));
	await transaction.insert(itemDraft).values({ itemKey, patch: paper.payload, sourceConnectionKey: ADDED_PAPERS_SOURCE_CONNECTION_KEY });
	// What the paper arrived as, from OpenAlex or its DOI: a reviewer's correction is measured against it, so it
	// outlives the syncs that follow, the first of which also brings the work's topics.
	await transaction.insert(itemSourceValue).values({ itemKey, sourceConnectionKey: ADDED_PAPERS_SOURCE_CONNECTION_KEY, payload: paper.payload, remoteVersion: paper.remoteVersion ?? null, importedTopics: true });
	await transaction.insert(addedPaper).values({
		itemKey,
		openalexId: paper.openalexId,
		doi: paper.doi,
		state: "pending",
		addedBy: input.actor.userId,
		addedByName: input.actor.name,
		addedByEmail: input.actor.email ?? null,
		requestId: input.requestId,
		suggested: input.actor.role === "reader",
	});
	return { at: paper.at, itemKey, foundBy: paper.openalexId ? "openalex" : "doi" };
}

/** What the community holds of these papers: the ones sent before, and records of their works or DOIs. */
export async function knownPapers(transaction: Database | DatabaseTransaction, found: readonly Found[], requestId?: string): Promise<Known> {
	const works = [...new Set(found.flatMap((paper) => paper.openalexId ?? []))];
	const dois = [...new Set(found.flatMap((paper) => paper.doi ?? []))];
	const matches = [...(works.length ? [inArray(addedPaper.openalexId, works)] : []), ...(dois.length ? [inArray(addedPaper.doi, dois)] : [])];
	const rows = matches.length ? await transaction.select().from(addedPaper).where(or(...matches)) : [];
	const workKeys = await openAlexItemKeys(transaction, works);
	const existingDois = (await findExistingRecords(transaction, found.map((paper) => importIdentifiers({ DOI: paper.doi })))).doi;
	const live = await liveRecords(transaction, [...rows.map((row) => row.itemKey), ...existingDois.values()]);
	// A row stays while its record is in the community, while a deleted record still holds its work or DOI (that record
	// answers for it), or when this very request sent it, so a repeat of the request is answered as the first was.
	const held = new Set([...workKeys.values(), ...existingDois.values()]);
	const kept = (row: (typeof rows)[number]) => live.has(row.itemKey) || held.has(row.itemKey) || (requestId !== undefined && sentBy(row, requestId));
	const rowKeys = new Set(rows.filter(kept).map((row) => row.itemKey));
	return {
		sent: rows.filter((row) => live.has(row.itemKey) || (requestId !== undefined && sentBy(row, requestId))),
		// Gone: its record removed since (no draft left, and no record but a deleted one). Sent again, it's added anew.
		gone: rows.flatMap((row) => (kept(row) ? [] : [row.itemKey])),
		workKeys,
		// A deleted record with the same DOI holds the paper only while it keeps its row: a paper taken off is added anew.
		existingDois: new Map([...existingDois].filter(([, itemKey]) => live.has(itemKey) || rowKeys.has(itemKey))),
	};
}

/** Of these records, the ones still in the community: with a draft, or a record that isn't deleted. */
async function liveRecords(transaction: Database | DatabaseTransaction, keys: readonly string[]) {
	if (!keys.length) return new Set<string>();
	const drafts = await transaction.select({ key: itemDraft.itemKey }).from(itemDraft).where(inArray(itemDraft.itemKey, [...keys]));
	const records = await transaction.select({ key: item.key }).from(item).where(and(inArray(item.key, [...keys]), sql`coalesce(${item.deleted}, 0) <> 1`));
	return new Set([...drafts, ...records].map((row) => row.key));
}

/** Clears the rows of papers whose records were removed: they'd hold the work and DOI a new record of the paper needs. */
async function forgetGone(transaction: DatabaseTransaction, gone: readonly string[]) {
	if (gone.length) await transaction.delete(addedPaper).where(inArray(addedPaper.itemKey, [...gone]));
}

/** Refuses one more suggestion past the day's number. Only the records this request makes count: ones it resumes were counted when made. */
function assertRoom(created: number, left: number) {
	if (created >= left) throw new AdminValidationError("This community takes no more suggested papers from you today. Try again tomorrow.");
}

/**
 * Makes a record for each paper new to the community, in one transaction that takes turns with other requests, so a
 * repeated or concurrent request finds the papers the first one sent instead of racing its checks.
 */
function createRecords(db: Database, found: readonly Found[], input: AddPapersInput, results: Results) {
	return db.transaction(async (transaction) => {
		// The OpenAlex writer's own lock: an import of the same work by another source waits, so neither makes a second record.
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`);
		const known = await knownPapers(transaction, found, input.requestId);
		await forgetGone(transaction, known.gone);
		const left = await suggestionsLeft(transaction, input.actor);
		const made: Made[] = [];
		let created = 0;
		const seen = new Map<string, string>();
		for (const paper of found) {
			// Sent before and not yet accepted: this request's own, whose submission or approval may not have finished, or
			// another's, which sends it again. Either goes on from where its review stands.
			const waiting = known.sent.find((row) => row.state === "pending" && ((paper.openalexId && row.openalexId === paper.openalexId) || (paper.doi && row.doi === paper.doi)));
			if (waiting) {
				made.push({ at: paper.at, itemKey: waiting.itemKey, foundBy: waiting.openalexId ? "openalex" : "doi", again: !sentBy(waiting, input.requestId) });
				continue;
			}
			const answer = knownPaper(paper, known, input.requestId);
			// The same work named twice in one request, such as by its OpenAlex ID and its DOI.
			const twice = [paper.openalexId, paper.doi].flatMap((id) => (id && seen.get(id)) || []);
			if (answer || twice.length) {
				results.set(paper.at, answer ?? { at: paper.at, outcome: "existing", itemKey: twice[0] });
				continue;
			}
			assertRoom(created++, left);
			const record = await createRecord(transaction, paper, input);
			for (const id of [paper.openalexId, paper.doi]) if (id) seen.set(id, record.itemKey);
			made.push(record);
		}
		return made;
	});
}

/**
 * Submits each new record as the person who sent it, or takes up the review a stopped request left pending, and
 * publishes it at once when they chose to.
 */
async function sendRecords(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, made: readonly Made[], input: AddPapersInput, results: Results) {
	for (const paper of made) {
		try {
			results.set(paper.at, { at: paper.at, outcome: await sendRecord(db, storage, config, paper, input), itemKey: paper.itemKey, foundBy: paper.foundBy });
		} catch (error) {
			console.error("[added papers] could not send", { itemKey: paper.itemKey, error: String(error) });
			results.set(paper.at, { at: paper.at, outcome: "failed", itemKey: paper.itemKey, message: error instanceof AdminValidationError ? error.message : "The paper was saved as a draft but could not be sent. Open it in the admin to send it." });
		}
	}
}

/** The record's latest review, if it has one. */
export async function latestReview(db: Database, itemKey: string) {
	const [latest] = await db.select({ id: itemReview.id, revision: itemReview.revision, state: itemReview.state }).from(itemReview).where(eq(itemReview.itemKey, itemKey)).orderBy(desc(itemReview.submittedAt)).limit(1);
	return latest;
}

/** Records a request that sent a paper again, so a replay of it later leaves a return alone. */
const noteResend = (db: Database | DatabaseTransaction, itemKey: string, requestId: string) =>
	db.update(addedPaper).set({ resendRequestIds: sql`array_append(${addedPaper.resendRequestIds}, ${requestId})` }).where(and(eq(addedPaper.itemKey, itemKey), sql`NOT (${requestId} = ANY(${addedPaper.resendRequestIds}))`));

/**
 * Submits the record for review with who sent it, noting the request when it sends a paper reviewed before. The review
 * keeps its own sender: someone else may send the paper again after a return, and the paper's row stays its first
 * sender's, which the daily suggestion count reads.
 */
const submitAgain = (db: Database, config: LibraryServerConfig, itemKey: string, reviewedBefore: boolean, input: AddPapersInput) =>
	submitItemReview(db, itemKey, reviewerOf(input.actor), config, async (transaction, review) => {
		await transaction.insert(itemReviewSender).values({ reviewId: review.id, name: input.actor.name, email: input.actor.email ?? null, suggested: input.actor.role === "reader" });
		if (reviewedBefore) await noteResend(transaction, itemKey, input.requestId);
	});

/**
 * Sends one record on, and answers where it got to. A review returned or withdrawn stays so when its own request is
 * replayed; a new request submits the record again.
 */
async function sendRecord(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, { itemKey, again }: Made, input: AddPapersInput): Promise<AddedPaperResult["outcome"]> {
	const latest = await latestReview(db, itemKey);
	if (latest?.state === "published") return "added";
	if (latest && latest.state !== "pending" && !again) return "returned";
	const review = latest?.state === "pending" ? latest : await submitAgain(db, config, itemKey, latest !== undefined, input);
	if (!input.publish) return "queued";
	await approveItemReview(db, storage, { reviewId: review.id, expectedRevision: review.revision }, reviewerOf(input.actor), config);
	return "added";
}

/**
 * Looks each paper up: by its OpenAlex ID, then OpenAlex by its DOI, then the DOI on its own. Returns the ones found;
 * the rest have their answer in `results`.
 */
export async function lookUpPapers(papers: readonly PaperReference[], lookup: PaperLookup, results: Results) {
	const linked = await linkedPapers(papers, lookup);
	const refs = papers.map((paper, at) => {
		const ids = linked.has(at) ? (linked.get(at) ?? { openalexId: null, doi: null }) : paper;
		return { at, openalexId: workOf(ids.openalexId), doi: normalizeDoi(ids.doi) };
	});
	for (const ref of refs) {
		if (ref.openalexId || ref.doi) continue;
		results.set(ref.at, { at: ref.at, outcome: "not_found", message: linked.get(ref.at) === null ? "Openscholar finds no paper at this address." : "This is not an OpenAlex ID, a DOI or a link to a paper." });
	}
	const reports = await findOnOpenscholar(refs.filter((ref) => !results.has(ref.at)), lookup, results);
	const taken = new Set(reports.map((paper) => paper.at));
	const onOpenAlex = await findOnOpenAlex(refs.filter((ref) => !results.has(ref.at) && !taken.has(ref.at)), lookup, results);
	// A paper given by its OpenAlex work alone has a DOI only now. If that DOI is a report's, the paper is the report:
	// it is taken from Openscholar like one given by its DOI, and a withdrawn one isn't added through OpenAlex's copy.
	const learned = onOpenAlex.found.filter((paper) => paper.doi && refs[paper.at]?.doi !== paper.doi);
	const late = await findOnOpenscholar(learned.map((paper) => ({ at: paper.at, openalexId: null, doi: paper.doi })), lookup, results);
	const replaced = new Set([...late.map((paper) => paper.at), ...learned.filter((paper) => results.has(paper.at)).map((paper) => paper.at)]);
	return [...reports, ...late, ...onOpenAlex.found.filter((paper) => !replaced.has(paper.at)), ...(await findByDoi(onOpenAlex.doiOnly, lookup, results))];
}

/**
 * Adds papers to the community by OpenAlex ID or DOI (OpenDevEd/new-el#773). Each is looked up by its OpenAlex ID,
 * then OpenAlex by its DOI, then the DOI lookup the admin import uses. A paper found becomes a record of the Added
 * papers source, submitted for review as the person who sent it and, when they publish, approved at once. A paper
 * already in the community, or already sent, is reported, not added again.
 */
export async function addPapers(
	db: Database,
	storage: EvidenceFileStorage,
	config: LibraryServerConfig,
	input: AddPapersInput,
	lookup: PaperLookup = paperLookupFor(config, input.actor.role === "reader" ? input.actor.userId : undefined),
): Promise<{ results: AddedPaperResult[] }> {
	if (input.papers.length > ADD_PAPERS_MAX) throw new AdminValidationError(`Add no more than ${ADD_PAPERS_MAX} papers at once.`);
	if (input.publish && reviewerOf(input.actor).role === "creator") throw new AdminValidationError("Only an Editor or Owner can publish papers.");
	const results: Results = new Map();
	const found = await lookUpPapers(input.papers, lookup, results);
	const made = await createRecords(db, found, input, results);
	await sendRecords(db, storage, config, made, input, results);
	// The source imports what was just published from OpenAlex at its next sweep; asked now, it starts right away.
	if (input.publish && made.length) await requestSourceRun(db, ADDED_PAPERS_SOURCE_CONNECTION_KEY);
	const sent = new Map(found.map((paper) => [paper.at, { ...summaryOf(paper.payload), openalexId: paper.openalexId, doi: paper.doi }]));
	return { results: input.papers.map((_, at) => withSummary(results.get(at)!, sent.get(at))) };
}

/** A paper sent on carries what it is, for the sender's list of submissions. */
const withSummary = (result: AddedPaperResult, paper: SentPaper | undefined): AddedPaperResult =>
	paper && (result.outcome === "added" || result.outcome === "queued") ? { ...result, paper } : result;
