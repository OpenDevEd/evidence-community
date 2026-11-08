import { itemDraft } from "@opendeved/evidence-library-core";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { addedPaper } from "@/db/schema/source";
import { itemReview } from "@/db/schema/review";
import { item } from "@/db/schema/tables/item";

import { ADD_PAPERS_MAX, knownPapers, lookUpPapers, paperLookupFor, type Found, type PaperLookup, type PaperReference, type Results } from "./added-papers-service";

/** A paper as a list of added papers shows it: its title, authors and year. */
type PaperSummary = { title: string; authors: string; year: number | null };

/**
 * Where an added paper stands: on the community and kept up to date from OpenAlex (`live`), on it from its DOI alone
 * and looked for on OpenAlex at each sync (`doi_only`), waiting in the review queue (`queued`), or returned or
 * withdrawn (`returned`), with the reviewer's note.
 */
type AddedPaperStatus = "live" | "doi_only" | "queued" | "returned";

type Creator = { firstName?: unknown; lastName?: unknown; name?: unknown };

/** The title, first authors and year a record's payload or row holds. */
function summaryOf(record: { title?: unknown; creators?: unknown; date?: unknown }): PaperSummary {
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

type PreviewResult = {
	at: number;
	/** `found`: new to the community; `existing`: already one of its records; `queued`: already waiting for review. */
	outcome: "found" | "existing" | "queued" | "not_found";
	itemKey?: string;
	foundBy?: "openalex" | "doi";
	paper?: PaperSummary & { openalexId: string | null; doi: string | null };
	message?: string;
};

/** Where one paper found would land: new to the community, already one of its records, or waiting for review. */
function previewOf(paper: Found, known: Awaited<ReturnType<typeof knownPapers>>): PreviewResult {
	const sent = sentRow(paper, known.sent);
	const itemKey = sent?.itemKey ?? recordHolding(paper, known);
	return {
		at: paper.at,
		outcome: sent?.state === "pending" ? "queued" : itemKey ? "existing" : "found",
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
	for (const paper of found) preview.set(paper.at, previewOf(paper, known));
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

/** A page cursor: the last row's time and id, newest first. */
const cursorOf = (row: { addedAt: Date; id: string }) => `${row.addedAt.toISOString()}|${row.id}`;
const parseCursor = (cursor: string | null) => {
	const [at, id] = cursor?.split("|") ?? [];
	return at && id && !Number.isNaN(Date.parse(at)) ? { at: new Date(at), id } : null;
};

/**
 * The community's added papers, newest first, a page at a time, with where each stands and how many are live and
 * waiting in all. A paper waiting for review shows its draft; one on the community, its published record.
 */
export async function listAddedPapers(db: Database, { cursor, limit }: { cursor: string | null; limit: number }) {
	const after = parseCursor(cursor);
	const rows = await db
		.select()
		.from(addedPaper)
		.where(after ? or(lt(addedPaper.addedAt, after.at), and(eq(addedPaper.addedAt, after.at), lt(addedPaper.id, after.id))) : undefined)
		.orderBy(desc(addedPaper.addedAt), desc(addedPaper.id))
		.limit(limit + 1);
	const page = rows.slice(0, limit);
	const keys = page.map((row) => row.itemKey);
	const [records, drafts, reviews, counts] = await Promise.all([
		keys.length ? db.select({ key: item.key, title: item.title, creators: item.creators, date: item.date }).from(item).where(inArray(item.key, keys)) : [],
		keys.length ? db.select({ itemKey: itemDraft.itemKey, patch: itemDraft.patch }).from(itemDraft).where(inArray(itemDraft.itemKey, keys)) : [],
		keys.length
			? db
					.selectDistinctOn([itemReview.itemKey], { itemKey: itemReview.itemKey, state: itemReview.state, note: itemReview.note })
					.from(itemReview)
					.where(inArray(itemReview.itemKey, keys))
					.orderBy(itemReview.itemKey, desc(itemReview.submittedAt))
			: [],
		db
			.select({ state: addedPaper.state, count: sql<number>`count(*)::int` })
			.from(addedPaper)
			.groupBy(addedPaper.state),
	]);
	const recordOf = new Map(records.map((record) => [record.key, record]));
	const draftOf = new Map(drafts.map((draft) => [draft.itemKey, draft.patch as Record<string, unknown>]));
	const reviewOf = new Map(reviews.map((review) => [review.itemKey, review]));
	const papers = page.map((row) => rowOf(row, { record: recordOf.get(row.itemKey), draft: draftOf.get(row.itemKey), review: reviewOf.get(row.itemKey) }));
	const total = (state: "pending" | "accepted") => counts.find((count) => count.state === state)?.count ?? 0;
	return {
		papers,
		next: rows.length > limit ? cursorOf(page.at(-1)!) : null,
		counts: { live: total("accepted"), waiting: total("pending") },
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
