import { findPdf, isPdf, type Memory, type Missed } from "@opendeved/paper-pdf";
import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { computedCache } from "@/db/schema/tables/computedCache";
import { publicTransport } from "@/lib/public-fetch";
import { itemUpsertSchema, type SourceItemUpsert } from "../batch-schema";

export { isPdf };

// Crossref and Unpaywall ask callers to name themselves by email; this is the platform's.
const CONTACT_EMAIL = "habari@openscholar.ai";
// A large PDF on a slow host may take this long; time spent waiting for a busy host's turn is not counted.
const SEARCH_BUDGET_MS = 120_000;

/**
 * What the PDF search remembers between imports, kept in the library's database: a paper that had no copy and when
 * to look again, and a host that refuses scripts. A remembered paper costs no request until then.
 */
export function pdfSearchMemory(database: Database): Memory {
	const row = (key: string) => `pdf-search:${key}`;
	return {
		async get(key) {
			const [found] = await database.select({ value: computedCache.value }).from(computedCache).where(eq(computedCache.key, row(key))).limit(1);
			return found?.value;
		},
		async set(key, value) {
			if (value == null) {
				await database.delete(computedCache).where(eq(computedCache.key, row(key)));
				return;
			}
			const computedAt = new Date();
			await database.insert(computedCache).values({ key: row(key), value, computedAt }).onConflictDoUpdate({ target: computedCache.key, set: { value, computedAt } });
		},
	};
}

/**
 * Records whose PDF the quick search missed, waiting for the full search. They are kept in the database, so an
 * import that stops part-way leaves them for the next run. Losing these rows only delays a search until the next
 * full import finds the PDF missing again.
 */
export function pdfSearchQueue(database: Database) {
	const rows = (sourceConnectionKey: string) => `pdf-search:todo:${sourceConnectionKey}:`;
	return {
		async add(sourceConnectionKey: string, record: SourceItemUpsert) {
			const waiting = { key: rows(sourceConnectionKey) + record.sourceRecordKey, value: record, computedAt: new Date() };
			await database.insert(computedCache).values(waiting).onConflictDoUpdate({ target: computedCache.key, set: { value: waiting.value, computedAt: waiting.computedAt } });
		},
		/** The next records to search, oldest key first. A row an older release wrote in another shape comes back without its record. */
		async take(sourceConnectionKey: string, limit: number) {
			const found = await database
				.select({ key: computedCache.key, value: computedCache.value })
				.from(computedCache)
				.where(sql`starts_with(${computedCache.key}, ${rows(sourceConnectionKey)})`)
				.orderBy(computedCache.key)
				.limit(limit);
			return found.map(({ key, value }) => {
				// JSON keeps a record's two dates as text.
				const saved = value as { sourceDates?: Record<string, unknown> | null };
				const sourceDates = saved.sourceDates && Object.fromEntries(Object.entries(saved.sourceDates).map(([name, date]) => [name, typeof date === "string" ? new Date(date) : date]));
				const record = itemUpsertSchema.safeParse({ ...saved, sourceDates });
				return { key, record: record.success ? record.data : null };
			});
		},
		async done(keys: string[]) {
			if (keys.length) await database.delete(computedCache).where(inArray(computedCache.key, keys));
		},
	};
}

const WHY: Record<Missed["reason"], string> = {
	closed: "The paper is not open access",
	blocked: "The site that holds the PDF refuses automated requests",
	no_pdf: "No link returned the paper's PDF",
	unreachable: "The sites that hold the PDF did not answer",
};

/** No copy of a record's PDF was found. `full` says the search went past the record's own links. */
export class PdfNotFound extends Error {
	constructor(
		readonly miss: Missed,
		readonly full: boolean,
		link: string,
	) {
		// What the record's own link did, so the issue says what went wrong with the link it shows. Other copies are
		// tried beside it and may answer first.
		const first = miss.attempts.find((attempt) => attempt.url === link) ?? miss.attempts.find((attempt) => attempt.outcome !== "lookup");
		const detail = first ? ` (${first.note ?? first.outcome}${first.status && !first.note?.includes(String(first.status)) ? `, HTTP ${first.status}` : ""})` : "";
		const why = first?.outcome === "too_large" ? "The PDF is too large" : WHY[miss.reason];
		super(`${why}${detail}${miss.remembered ? ", as an earlier search found" : ""}`);
	}
}

type Search = {
	maxBytes: number;
	memory: Memory;
	/** The paper's OpenAlex ID, which a remembered miss is filed under when the paper has no DOI. */
	openalexId?: string | undefined;
	/**
	 * Only the record's own links and the PDFs their pages lead to, at the speed of those sites. The full search also
	 * asks Crossref and the Internet Archive, which answer at a steady pace however many searches are waiting.
	 */
	quick: boolean;
};

/**
 * The work's PDF from its chosen link, else from its other open copies, else, in the full search, from a copy
 * Crossref or the Internet Archive knows. Throws `PdfNotFound` when there is none.
 */
export async function downloadPaperPdf(link: string, raw: Record<string, unknown>, search: Search): Promise<Uint8Array> {
	const otherCopies = Array.isArray(raw.otherCopies) ? raw.otherCopies.filter((copy): copy is string => typeof copy === "string") : [];
	// A remembered miss stands for the link it was found with: a record whose link changed is searched afresh.
	const paper = (key: string) => (key.startsWith("paper:") ? `${key} ${link}` : key);
	const memory: Memory = { get: (key) => search.memory.get(paper(key)), set: (key, value) => search.memory.set(paper(key), value) };
	const result = await findPdf(
		// The record carries every copy OpenAlex lists, so Unpaywall, whose copies are the same, is not asked.
		{ ...(typeof raw.doi === "string" ? { doi: raw.doi } : {}), openalexId: search.openalexId, urls: [link, ...otherCopies], openAlexLinks: true, openAccess: true },
		{
			fetch: publicTransport,
			userAgent: "Evidence-Library/1.0",
			contactEmail: CONTACT_EMAIL,
			memory,
			maxBytes: search.maxBytes,
			budgetMs: SEARCH_BUDGET_MS,
			quick: search.quick,
		},
	);
	if (!result.ok) throw new PdfNotFound(result, !search.quick, link);
	return result.bytes;
}
