import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { itemGrade, itemReading, readingSpend } from "@/db/schema/readings";
import { abstractPlainText } from "@/lib/abstract-text";
import { askJev } from "./jev";
import { metadataStudyType } from "./metadata-type";
import { QUESTION_SET, readingAnswers, readingQuestions, type ReadingAsk, type ReadingAnswers } from "./questions";
import type { StudyTypeKey } from "./study-types";

/** Records claimed at once, and how many of them are read at the same time. */
const BATCH = 32;
const AT_ONCE = 16;
/** A cycle reads for this long, so the worker's other cycles keep their turn. */
const CYCLE_MS = 20_000;
/** Jev reads 32K tokens; an abstract is cut well inside that, as OpenScholar cuts it. */
const ABSTRACT_CHARS = 3_000;

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** The library's own OpenRouter key, when its AI is on; without it nothing is read. */
function readingKey(config: LibraryServerConfig) {
	if (!config.features.ai) return null;
	return config.ai.providers.find((provider) => provider.enabled && provider.provider === "openrouter")?.apiKey ?? null;
}

/** The subject of each source that screens its records, by source key. */
function screeningSubjects(config: LibraryServerConfig) {
	return new Map(config.sources.filter((source) => source.enabled && source.screening.enabled)
		.map((source) => [source.key, { subject: source.screening.subject, hash: hash(source.screening.subject) }]));
}

/** A record as a read needs it. */
type RecordFacts = { key: string; title: string; abstract: string; itemType: string; openAlexType: string | null; doi: string | null; sources: string[] };
/** What is stored about a record already: its reading's text hash, question set and type, and each grade's subject hash. */
type Stored = { reading?: { contentHash: string; questionSet: number; studyType: StudyTypeKey; typedBy: "ai" | "metadata" }; grades: Map<string, string> };
type Subject = { key: string; subject: string; hash: string };

/**
 * What a read of this record asks, or null when nothing has changed. A record whose text and question set are what
 * its reading was made from asks only the grades whose subject changed; otherwise it is read whole, every screening
 * source graded again. The type is never asked when the record's own metadata gives it, and a change in what the
 * metadata says retypes a record whose text has not changed: at no cost when the metadata now gives the type, with a
 * type-only question when it no longer does.
 */
export function planRead(record: RecordFacts, stored: Stored, subjects: Subject[]) {
	const contentHash = hash(`${record.title}\n${record.abstract}`);
	const fresh = stored.reading?.contentHash === contentHash && stored.reading.questionSet === QUESTION_SET;
	const metadataType = metadataStudyType(record);
	const retype = fresh && (metadataType
		? stored.reading!.typedBy !== "metadata" || stored.reading!.studyType !== metadataType
		: stored.reading!.typedBy === "metadata");
	const graded = fresh ? subjects.filter((subject) => stored.grades.get(subject.key) !== subject.hash) : subjects;
	if (fresh && !graded.length && !retype) return null;
	const ask: ReadingAsk = { type: !metadataType && (!fresh || retype), details: !fresh, subjects: graded.map((subject) => subject.subject) };
	return { ask, contentHash, fresh, retype, metadataType, graded };
}
type Plan = NonNullable<ReturnType<typeof planRead>>;
/** Whether a plan needs Jev at all: a metadata retype alone does not. */
const asksJev = (ask: ReadingAsk) => ask.type || ask.details || ask.subjects.length > 0;

/** The type a read stores: the metadata's, else Jev's answer. */
const typeFields = (plan: Plan, read: ReadingAnswers): { studyType: StudyTypeKey; typeConfidence: number; typedBy: "ai" | "metadata" } =>
	plan.metadataType
		? { studyType: plan.metadataType, typeConfidence: 1, typedBy: "metadata" }
		: { studyType: read.type!.key, typeConfidence: read.type!.confidence, typedBy: "ai" };

/** The reading row a whole read stores. */
function readingRow(record: RecordFacts, plan: Plan, read: ReadingAnswers, model: string) {
	return {
		itemKey: record.key, ...typeFields(plan, read),
		pooled: read.details!.pooled, region: read.details!.region, effects: read.details!.effects,
		input: record.abstract ? "abstract" as const : "title" as const, contentHash: plan.contentHash, questionSet: QUESTION_SET, model, readAt: new Date(),
	};
}

async function claim(database: Database, token: string) {
	const { rows } = await database.execute<{ itemKey: string; generation: number; attempts: number }>(sql`
		UPDATE "itemReadingQueue" SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + interval '3 minutes'
		WHERE "itemKey" IN (SELECT "itemKey" FROM "itemReadingQueue"
			WHERE "nextAttemptAt" <= now() AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
			ORDER BY "nextAttemptAt", "itemKey" LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
		RETURNING "itemKey", "generation", "attempts"`);
	return rows;
}

async function recordFacts(database: Database, keys: string[]) {
	const list = sql`ARRAY[${sql.join(keys.map((key) => sql`${key}`), sql`, `)}]::varchar[]`;
	const { rows } = await database.execute<{ key: string; title: string | null; abstractNote: string | null; itemType: string; DOI: string | null; openAlexType: string | null; sources: string[] }>(sql`
		SELECT i.key, i.title, i."abstractNote", i."itemType"::text AS "itemType", i."DOI",
			(SELECT s.payload ->> 'type' FROM "sourceSnapshot" s WHERE s."itemKey" = i.key AND s.payload ? 'type' LIMIT 1) AS "openAlexType",
			ARRAY(SELECT l."sourceConnectionKey" FROM "itemSourceLink" l WHERE l."itemKey" = i.key AND NOT l."remoteDeleted") AS sources
		FROM "item" i WHERE i.key = ANY(${list}) AND coalesce(i.deleted, 0) <> 1 AND coalesce(i."parentItem", '') = ''`);
	const readings = await database.execute<{ itemKey: string; contentHash: string; questionSet: number; studyType: StudyTypeKey; typedBy: "ai" | "metadata" }>(sql`
		SELECT "itemKey", "contentHash", "questionSet", "studyType", "typedBy" FROM "itemReading" WHERE "itemKey" = ANY(${list})`);
	const grades = await database.execute<{ itemKey: string; sourceConnectionKey: string; subjectHash: string }>(sql`
		SELECT "itemKey", "sourceConnectionKey", "subjectHash" FROM "itemGrade" WHERE "itemKey" = ANY(${list})`);
	return rows.map((row) => ({
		record: {
			key: row.key, title: row.title ?? "", abstract: abstractPlainText(row.abstractNote).slice(0, ABSTRACT_CHARS),
			itemType: row.itemType, openAlexType: row.openAlexType, doi: row.DOI, sources: row.sources,
		},
		stored: {
			reading: readings.rows.find((reading) => reading.itemKey === row.key),
			grades: new Map(grades.rows.filter((grade) => grade.itemKey === row.key).map((grade) => [grade.sourceConnectionKey, grade.subjectHash])),
		},
	}));
}

/** Leaves a queued record done, unless it was queued again while it was being read. */
async function finish(database: Database, key: string, token: string) {
	await database.execute(sql`UPDATE "itemReadingQueue" SET "nextAttemptAt" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
		WHERE "itemKey" = ${key} AND "leaseToken" = ${token}`);
}

async function fail(database: Database, job: { itemKey: string; attempts: number }, token: string, error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	const attempts = job.attempts + 1;
	console.error("Record reading failed", { itemKey: job.itemKey, attempts, error: message });
	await database.execute(sql`UPDATE "itemReadingQueue" SET "attempts" = ${attempts},
		"nextAttemptAt" = ${new Date(Date.now() + Math.min(3_600_000, 1_000 * 2 ** Math.min(attempts, 12)))},
		"leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = ${message.slice(0, 2_000)}
		WHERE "itemKey" = ${job.itemKey} AND "leaseToken" = ${token}`);
}

/**
 * Reads one claimed record, when anything about it needs reading, and stores what Jev answered. What it spent is kept
 * whatever happens; the answers are kept only while the claim is still this cycle's, so a record queued again during
 * the call is read again instead of taking answers about its older text.
 */
async function readOne(
	database: Database, apiKey: string, subjects: Map<string, { subject: string; hash: string }>,
	facts: Awaited<ReturnType<typeof recordFacts>>[number] | undefined, job: { itemKey: string; attempts: number }, token: string,
	signal?: AbortSignal, request?: typeof fetch,
) {
	const screened = facts ? facts.record.sources.flatMap((key) => {
		const subject = subjects.get(key);
		return subject ? [{ key, ...subject }] : [];
	}) : [];
	// A record gone, or held by no screening source, has nothing to read.
	const plan = facts && screened.length ? planRead(facts.record, facts.stored, screened) : null;
	if (!facts || !plan) return finish(database, job.itemKey, token);
	try {
		const { record } = facts;
		const answer = asksJev(plan.ask)
			? await askJev({ apiKey, state: { title: record.title, ...(record.abstract ? { abstract: record.abstract } : {}) }, questions: readingQuestions(plan.ask), signal, request })
			: null;
		const read = answer ? readingAnswers(plan.ask, answer.answers) : { scores: [] };
		await database.transaction(async (tx) => {
			if (answer) await tx.insert(readingSpend).values({ day: new Date().toISOString().slice(0, 10), reads: 1, usd: answer.usd })
				.onConflictDoUpdate({ target: readingSpend.day, set: { reads: sql`${readingSpend.reads} + 1`, usd: sql`${readingSpend.usd} + ${answer.usd}` } });
			const owned = await tx.execute(sql`UPDATE "itemReadingQueue" SET "nextAttemptAt" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
				WHERE "itemKey" = ${record.key} AND "leaseToken" = ${token} RETURNING "itemKey"`);
			if (!owned.rows.length) return;
			if (!plan.fresh) {
				const row = readingRow(record, plan, read, answer!.model);
				await tx.insert(itemReading).values(row).onConflictDoUpdate({ target: itemReading.itemKey, set: row });
			} else if (plan.retype) {
				await tx.update(itemReading).set(typeFields(plan, read)).where(sql`${itemReading.itemKey} = ${record.key}`);
			}
			for (const [index, subject] of plan.graded.entries()) {
				const grade = { itemKey: record.key, sourceConnectionKey: subject.key, score: read.scores[index], subjectHash: subject.hash, gradedAt: new Date() };
				await tx.insert(itemGrade).values(grade).onConflictDoUpdate({ target: [itemGrade.itemKey, itemGrade.sourceConnectionKey], set: grade });
			}
		});
	} catch (error) {
		await fail(database, job, token, error);
	}
}

/**
 * Leaves every waiting record done without reading it: what was published while nothing screens, or without a key, is
 * read only when the owner asks for it, so turning screening on never spends on its own.
 */
async function drain(database: Database) {
	await database.execute(sql`UPDATE "itemReadingQueue" SET "nextAttemptAt" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL
		WHERE "nextAttemptAt" IS NOT NULL AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())`);
}

/** Hands back the claims a cycle ran out of time for, so the next cycle takes them at once. */
async function release(database: Database, keys: string[], token: string) {
	if (!keys.length) return;
	await database.execute(sql`UPDATE "itemReadingQueue" SET "leaseToken" = NULL, "leaseExpiresAt" = NULL
		WHERE "itemKey" = ANY(ARRAY[${sql.join(keys.map((key) => sql`${key}`), sql`, `)}]::varchar[]) AND "leaseToken" = ${token}`);
}

/**
 * Reads the records waiting in the queue, a batch at a time, for up to `CYCLE_MS`; no call starts after that, and the
 * records it did not reach are handed back. Each record is read once by Jev on the library's own key: its study type
 * and details when its text changed, and its grade against each screening source whose subject changed. Returns
 * whether it read anything.
 */
export async function runReadingCycle(database: Database, config: LibraryServerConfig, signal?: AbortSignal, request?: typeof fetch) {
	const apiKey = readingKey(config);
	const subjects = screeningSubjects(config);
	if (!apiKey || !subjects.size) {
		await drain(database);
		return false;
	}
	const deadline = Date.now() + CYCLE_MS;
	let worked = false;
	while (Date.now() < deadline && !signal?.aborted) {
		const token = randomUUID();
		const jobs = await claim(database, token);
		if (!jobs.length) break;
		worked = true;
		const facts = new Map((await recordFacts(database, jobs.map((job) => job.itemKey))).map((entry) => [entry.record.key, entry]));
		let next = 0;
		await Promise.all(Array.from({ length: Math.min(AT_ONCE, jobs.length) }, async () => {
			while (next < jobs.length && Date.now() < deadline && !signal?.aborted) {
				const job = jobs[next++]!;
				await readOne(database, apiKey, subjects, facts.get(job.itemKey), job, token, signal, request);
			}
		}));
		await release(database, jobs.slice(next).map((job) => job.itemKey), token);
	}
	return worked;
}
