import { itemDraft } from "@opendeved/evidence-library-core";
import { and, desc, inArray, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { addedPaper } from "@/db/schema/source";
import { itemReview } from "@/db/schema/review";
import { item } from "@/db/schema/tables/item";

import { ADD_PAPERS_MAX, knownPapers, lookUpPapers, paperLookupFor, type Found, type PaperLookup, type PaperReference, type Results } from "./added-papers-service";
import { summaryOf, type PaperSummary } from "./paper-summary";

/**
 * Where an added paper stands: on the community and kept up to date from OpenAlex (`live`), on it from its DOI alone
 * and looked for on OpenAlex at each sync (`doi_only`), waiting in the review queue (`queued`), or returned or
 * withdrawn (`returned`), with the reviewer's note.
 */
type AddedPaperStatus = "live" | "doi_only" | "queued" | "returned";

type PreviewResult = {
	at: number;
	/**
	 * `found`: new to the community; `existing`: already one of its records; `queued`: already waiting for review;
	 * `returned`: sent before and returned or withdrawn, so adding it sends it again.
	 */
	outcome: "found" | "existing" | "queued" | "returned" | "not_found";
	itemKey?: string;
	foundBy?: "openalex" | "doi";
	paper?: PaperSummary & { openalexId: string | null; doi: string | null };
	message?: string;
};

/** Where one paper found would land: new to the community, already one of its records, or waiting for review. */
function previewOf(paper: Found, known: Awaited<ReturnType<typeof knownPapers>>, reviews: ReadonlyMap<string, string>): PreviewResult {
	const sent = sentRow(paper, known.sent);
	const itemKey = sent?.itemKey ?? recordHolding(paper, known);
	return {
		at: paper.at,
		outcome: sent?.state === "pending" ? (reviews.get(sent.itemKey) === "pending" ? "queued" : "returned") : itemKey ? "existing" : "found",
		...(itemKey ? { itemKey } : {}),
		foundBy: paper.openalexId ? "openalex" : "doi",
		paper: { ...summaryOf(paper.payload), openalexId: paper.openalexId, doi: paper.doi },
	};
}

/** The paper as sent to the community before, by its work or its DOI. */
const sentRow = (paper: Found, sent: readonly (typeof addedPaper.$inferSelect)[]) =>
	sent.find((row) => (paper.openalexId !== null && row.openalexId === paper.openalexId) || (paper.doi !== null && row.doi === paper.doi));

/** The community's record of the paper's work, or of its DOI. */
function recordHolding(paper: Found, known: Awaited<ReturnType<typeof knownPapers>>) {
	const byWork = paper.openalexId ? known.workKeys.get(paper.openalexId) : undefined;
	return byWork ?? (paper.doi ? known.existingDois.get(paper.doi) : undefined);
}

/**
 * What adding these papers would find, without adding anything: the same lookups as adding them, and whether the
 * community already has each one or holds it in its review queue.
 */
export async function previewPapers(db: Database, config: LibraryServerConfig, papers: readonly PaperReference[], lookup: PaperLookup = paperLookupFor(config)) {
	if (papers.length > ADD_PAPERS_MAX) throw new Error(`Look up no more than ${ADD_PAPERS_MAX} papers at once.`);
	const results: Results = new Map();
	const found = await lookUpPapers(papers, lookup, results);
	const known = await knownPapers(db, found);
	const preview = new Map<number, PreviewResult>([...results].map(([at, result]) => [at, { at, outcome: "not_found" as const, ...(result.message ? { message: result.message } : {}) }]));
	const reviews = await latestReviews(db, known.sent.filter((row) => row.state === "pending").map((row) => row.itemKey));
	const states = new Map([...reviews].map(([key, review]) => [key, review.state]));
	for (const paper of found) preview.set(paper.at, previewOf(paper, known, states));
	return { results: papers.map((_, at) => preview.get(at)!) };
}

type AddedPaperRow = PaperSummary & {
	itemKey: string;
	openalexId: string | null;
	doi: string | null;
	status: AddedPaperStatus;
	/** Why a reviewer returned it, when they said. */
	note: string | null;
	addedBy: string;
	addedByName: string | null;
	addedAt: string;
};

/** The last row a page read, by id: the next page starts after it, compared in the database at its full precision. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const after = (cursor: string | null) =>
	cursor && UUID.test(cursor) ? sql`("addedAt", "id") < (SELECT "addedAt", "id" FROM "addedPaper" WHERE "id" = ${cursor})` : undefined;

/**
 * The papers still listed: not unpublished by an editor, and not withdrawn from the queue by the person who sent them.
 * A paper taken off the community, or taken back, is no longer one of its added papers.
 */
const onCommunity = sql`NOT EXISTS (SELECT 1 FROM ${item} WHERE ${item.key} = ${addedPaper.itemKey} AND ${item.deleted} = 1)
	AND NOT (${addedPaper.state} = 'pending' AND (SELECT ${itemReview.state} FROM ${itemReview} WHERE ${itemReview.itemKey} = ${addedPaper.itemKey} ORDER BY ${itemReview.submittedAt} DESC LIMIT 1) IS NOT DISTINCT FROM 'withdrawn')`;

/** Each record's latest review, by key. */
async function latestReviews(db: Database, keys: readonly string[]) {
	const rows = keys.length
		? await db
				.selectDistinctOn([itemReview.itemKey], { itemKey: itemReview.itemKey, state: itemReview.state, note: itemReview.note })
				.from(itemReview)
				.where(inArray(itemReview.itemKey, [...keys]))
				.orderBy(itemReview.itemKey, desc(itemReview.submittedAt))
		: [];
	return new Map(rows.map((row) => [row.itemKey, row]));
}

/**
 * The community's added papers, newest first, a page at a time, with where each stands and how many there are, live and
 * waiting in all. A paper waiting for review shows its draft; one on the community, its published record.
 */
export async function listAddedPapers(db: Database, { cursor, limit }: { cursor: string | null; limit: number }) {
	const rows = await db
		.select()
		.from(addedPaper)
		.where(and(onCommunity, after(cursor)))
		.orderBy(desc(addedPaper.addedAt), desc(addedPaper.id))
		.limit(limit + 1);
	const page = rows.slice(0, limit);
	const keys = page.map((row) => row.itemKey);
	const [records, drafts, reviews, counts] = await Promise.all([
		keys.length ? db.select({ key: item.key, title: item.title, creators: item.creators, date: item.date }).from(item).where(inArray(item.key, keys)) : [],
		keys.length ? db.select({ itemKey: itemDraft.itemKey, patch: itemDraft.patch }).from(itemDraft).where(inArray(itemDraft.itemKey, keys)) : [],
		latestReviews(db, keys),
		db
			.select({
				total: sql<number>`count(*)::int`,
				live: sql<number>`count(*) FILTER (WHERE ${addedPaper.state} = 'accepted')::int`,
				// Waiting: sent and still in the review queue, not returned or withdrawn.
				waiting: sql<number>`count(*) FILTER (WHERE ${addedPaper.state} = 'pending' AND EXISTS (SELECT 1 FROM ${itemReview} WHERE ${itemReview.itemKey} = ${addedPaper.itemKey} AND ${itemReview.state} = 'pending'))::int`,
			})
			.from(addedPaper)
			.where(onCommunity),
	]);
	const recordOf = new Map(records.map((record) => [record.key, record]));
	const draftOf = new Map(drafts.map((draft) => [draft.itemKey, draft.patch as Record<string, unknown>]));
	const reviewOf = reviews;
	const papers = page.map((row) => rowOf(row, { record: recordOf.get(row.itemKey), draft: draftOf.get(row.itemKey), review: reviewOf.get(row.itemKey) }));
	return {
		papers,
		next: rows.length > limit ? page.at(-1)!.id : null,
		counts: { total: counts[0]?.total ?? 0, live: counts[0]?.live ?? 0, waiting: counts[0]?.waiting ?? 0 },
	};
}

/** One added paper as the list shows it: its accepted record's details, or its draft's while it waits. */
function rowOf(
	row: typeof addedPaper.$inferSelect,
	{ record, draft, review }: { record?: Record<string, unknown>; draft?: Record<string, unknown>; review?: { state: string; note: string | null } },
): AddedPaperRow {
	const status = statusOf(row, review);
	return {
		...summaryOf((row.state === "accepted" ? (record ?? draft) : (draft ?? record)) ?? {}),
		itemKey: row.itemKey,
		openalexId: row.openalexId,
		doi: row.doi,
		status,
		note: status === "returned" ? (review?.note ?? null) : null,
		addedBy: row.addedBy,
		addedByName: row.addedByName,
		addedAt: row.addedAt.toISOString(),
	};
}

/** Where an added paper stands, from its row and its latest review. */
function statusOf(row: typeof addedPaper.$inferSelect, review: { state: string } | undefined): AddedPaperStatus {
	if (row.state === "accepted") return row.openalexId ? "live" : "doi_only";
	return review && review.state !== "pending" ? "returned" : "queued";
}
