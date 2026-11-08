import { itemDraft, itemIdentity } from "@opendeved/evidence-library-core";
import { desc, eq, inArray, or, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { reserveItemIdentity } from "@/db/record-identity";
import { addedPaper } from "@/db/schema/source";
import { itemReview } from "@/db/schema/review";
import { itemSourceValue } from "@/db/schema/topics";
import { normalizeDoi } from "@/lib/doi";
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
async function suggestionsLeft(transaction: DatabaseTransaction, actor: AddPapersInput["actor"]) {
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

export type PaperReference = { openalexId?: string | null; doi?: string | null };

export type AddPapersInput = {
	/** OpenScholar's id for the request: sent again, it adds nothing twice. */
	requestId: string;
	/** Publish at once, which an owner or editor may; otherwise each paper waits in the review queue. */
	publish: boolean;
	/** A `reader` is anyone signed in outside the team: like a Creator, they only send papers to the review queue. */
	actor: { userId: string; name: string | null; role: "owner" | "editor" | "creator" | "reader" };
	papers: PaperReference[];
};

/** A paper as a list of added papers shows it: its title, authors and year. */
export type PaperSummary = { title: string; authors: string; year: number | null };


type Creator = { firstName?: unknown; lastName?: unknown; name?: unknown };

/** The title, first authors and year a record's payload or row holds. */
export function summaryOf(record: { title?: unknown; creators?: unknown; date?: unknown }): PaperSummary {
	const names = (Array.isArray(record.creators) ? (record.creators as Creator[]) : []).flatMap((creator) => {
		const name = typeof creator.name === "string" ? creator.name : [creator.firstName, creator.lastName].filter((part) => typeof part === "string" && part).join(" ");
		return name ? [name] : [];
	});
	const year = typeof record.date === "string" ? Number(record.date.match(/\b(\d{4})\b/u)?.[1]) || null : null;
	return {
		title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Untitled",
		authors: names.length > 3 ? `${names.slice(0, 3).join(", ")} et al.` : names.join(", "),
		year,
	};
}

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
};

const workOf = (id: string | null | undefined) => id?.trim().match(/(?:^|\/)(W[1-9]\d*)$/iu)?.[1]?.toUpperCase() ?? null;
/** The bare OpenAlex work (W2741809807) a work's `id` names, or null. */
export const workIdOf = (work: unknown) => workOf(String((work as { id?: unknown } | null)?.id ?? ""));
const chunks = <T,>(values: readonly T[]) => Array.from({ length: Math.ceil(values.length / OPENALEX_MAX_IDS_PER_FILTER) }, (_, at) => values.slice(at * OPENALEX_MAX_IDS_PER_FILTER, (at + 1) * OPENALEX_MAX_IDS_PER_FILTER));

/** The lookups a running library uses: its own OpenAlex key, and its Zotero translation service for DOIs. */
export function paperLookupFor(config: LibraryServerConfig): PaperLookup {
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
	};
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

type Known = { sent: (typeof addedPaper.$inferSelect)[]; workKeys: Map<string, string>; existingDois: ReadonlyMap<string, string> };

/**
 * What to answer for a paper the community already has: accepted before (the same answer to the same request), or
 * already one of its records. Null for a paper new to it.
 */
function knownPaper(paper: Found, known: Known, requestId: string): AddedPaperResult | null {
	const sent = known.sent.find((row) => (paper.openalexId && row.openalexId === paper.openalexId) || (paper.doi && row.doi === paper.doi));
	if (sent) {
		const outcome = sent.requestId === requestId ? "added" : "existing";
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
		requestId: input.requestId,
		suggested: input.actor.role === "reader",
	});
	return { at: paper.at, itemKey, foundBy: paper.openalexId ? "openalex" : "doi" };
}

/** What the community holds of these papers: the ones sent before, and records of their works or DOIs. */
export async function knownPapers(transaction: Database | DatabaseTransaction, found: readonly Found[]): Promise<Known> {
	const works = [...new Set(found.flatMap((paper) => paper.openalexId ?? []))];
	const dois = [...new Set(found.flatMap((paper) => paper.doi ?? []))];
	const matches = [...(works.length ? [inArray(addedPaper.openalexId, works)] : []), ...(dois.length ? [inArray(addedPaper.doi, dois)] : [])];
	return {
		sent: matches.length ? await transaction.select().from(addedPaper).where(or(...matches)) : [],
		workKeys: await openAlexItemKeys(transaction, works),
		existingDois: (await findExistingRecords(transaction, found.map((paper) => importIdentifiers({ DOI: paper.doi })))).doi,
	};
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
		const known = await knownPapers(transaction, found);
		const left = await suggestionsLeft(transaction, input.actor);
		const made: Made[] = [];
		let created = 0;
		const seen = new Map<string, string>();
		for (const paper of found) {
			// Sent before and not yet accepted: this request's own, whose submission or approval may not have finished, or
			// another's, which sends it again. Either goes on from where its review stands.
			const waiting = known.sent.find((row) => row.state === "pending" && ((paper.openalexId && row.openalexId === paper.openalexId) || (paper.doi && row.doi === paper.doi)));
			if (waiting) {
				made.push({ at: paper.at, itemKey: waiting.itemKey, foundBy: waiting.openalexId ? "openalex" : "doi", again: waiting.requestId !== input.requestId });
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

/**
 * Sends one record on, and answers where it got to. A review returned or withdrawn stays so when its own request is
 * replayed; a new request submits the record again.
 */
async function sendRecord(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, { itemKey, again }: Made, input: AddPapersInput): Promise<AddedPaperResult["outcome"]> {
	const latest = await latestReview(db, itemKey);
	if (latest?.state === "published") return "added";
	if (latest && latest.state !== "pending" && !again) return "returned";
	const review = latest?.state === "pending" ? latest : await submitItemReview(db, itemKey, reviewerOf(input.actor), config);
	if (!input.publish) return "queued";
	await approveItemReview(db, storage, { reviewId: review.id, expectedRevision: review.revision }, reviewerOf(input.actor), config);
	return "added";
}

/**
 * Looks each paper up: by its OpenAlex ID, then OpenAlex by its DOI, then the DOI on its own. Returns the ones found;
 * the rest have their answer in `results`.
 */
export async function lookUpPapers(papers: readonly PaperReference[], lookup: PaperLookup, results: Results) {
	const refs = papers.map((paper, at) => ({ at, openalexId: workOf(paper.openalexId), doi: normalizeDoi(paper.doi) }));
	for (const ref of refs) if (!ref.openalexId && !ref.doi) results.set(ref.at, { at: ref.at, outcome: "not_found", message: "This is not an OpenAlex ID or a DOI." });
	const onOpenAlex = await findOnOpenAlex(refs.filter((ref) => !results.has(ref.at)), lookup, results);
	return [...onOpenAlex.found, ...(await findByDoi(onOpenAlex.doiOnly, lookup, results))];
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
	lookup: PaperLookup = paperLookupFor(config),
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
