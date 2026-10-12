import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { LibraryServerConfig, ScreeningGrade } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemReading, readingSpend } from "@/db/schema/readings";
import { abstractPlainText } from "@/lib/abstract-text";
import { askJev } from "./jev";
import { metadataStudyType } from "./metadata-type";
import { QUESTION_SET, gradeOf, readingAnswers, readingQuestions, type ReadingAsk, type ReadingAnswers } from "./questions";
import { hash, keyArray, readingKey, refreshScreenedOut, screeningSubjects, settleScreening } from "./screening";
import type { StudyTypeKey } from "./study-types";

/** Records claimed at once, and how many of them are read at the same time. */
const BATCH = 32;
const AT_ONCE = 16;
/** A cycle reads for this long, so the worker's other cycles keep their turn. */
const CYCLE_MS = 20_000;
/** Jev reads 32K tokens; an abstract is cut well inside that, as OpenScholar cuts it, and a PDF at its opening pages. */
const ABSTRACT_CHARS = 3_000;
const PDF_CHARS = 12_000;
/** A type Jev gave with less confidence than this is asked again from the record's PDF, once it has one. */
const LOW_CONFIDENCE = 0.6;
const PDF_PAGE_MARK = /\*\*\|\|\s*PAGE\s+\d+\s*\|\|\*\*/giu;
/** Grades asked in one call, so a record many sources hold stays inside Jev's context; the rest are asked next. */
const GRADES_PER_CALL = 8;

/** A record as a read needs it; `pdf` is the opening of its PDF's text, empty without one. */
type RecordFacts = { key: string; title: string; abstract: string; pdf: string; itemType: string; openAlexType: string | null; doi: string | null; sources: string[] };
/**
 * What is stored about a record already: its reading's text hash, question set, type and what it was read from, and
 * the subject hashes each source's grade and pending grade were made against.
 */
type Stored = {
	reading?: { contentHash: string; questionSet: number; studyType: StudyTypeKey; typedBy: "ai" | "metadata"; typeConfidence: number; input: "abstract" | "title" | "pdf" };
	grades: Map<string, readonly (string | null)[]>;
};
type Subject = { key: string; subject: string; hash: string };

/**
 * What a read of this record asks, or null when nothing has changed. A record whose text and question set are what
 * its reading was made from asks only the grades whose subject changed; otherwise it is read whole, every screening
 * source graded again. The type is never asked when the record's own metadata gives it, and a change in what the
 * metadata says retypes a record whose text has not changed: at no cost when the metadata now gives the type, with a
 * type-only question when it no longer does. A type Jev was unsure of from the abstract is asked again from the PDF.
 */
type Reading = NonNullable<Stored["reading"]>;

/** Whether what the metadata says the record is differs from how its reading was typed. */
const metadataChanged = (reading: Reading, metadataType: StudyTypeKey | null) =>
	metadataType ? reading.typedBy !== "metadata" || reading.studyType !== metadataType : reading.typedBy === "metadata";

/** Whether Jev's type, unsure from the abstract, can be asked again from the PDF the record now has. */
const pdfCanSettle = (record: RecordFacts, reading: Reading) =>
	Boolean(record.pdf) && reading.typedBy === "ai" && reading.input !== "pdf" && reading.typeConfidence < LOW_CONFIDENCE;

export function planRead(record: RecordFacts, stored: Stored, subjects: Subject[]) {
	const contentHash = hash(`${record.title}\n${record.abstract}`);
	const fresh = stored.reading?.contentHash === contentHash && stored.reading.questionSet === QUESTION_SET;
	const metadataType = metadataStudyType(record);
	const retype = fresh && metadataChanged(stored.reading!, metadataType);
	const pdf = fresh && !retype && !metadataType && pdfCanSettle(record, stored.reading!);
	const stale = fresh ? subjects.filter((subject) => !stored.grades.get(subject.key)?.includes(subject.hash)) : subjects;
	if (fresh && !stale.length && !retype && !pdf) return null;
	const graded = stale.slice(0, GRADES_PER_CALL);
	const ask: ReadingAsk = { type: !metadataType && (!fresh || retype || pdf), details: !fresh, subjects: graded.map((subject) => subject.subject) };
	return { ask, contentHash, fresh, retype: retype || pdf, pdf, metadataType, graded, more: stale.length > graded.length };
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

/** A claimed record: how often it failed, and the sources whose owner's request queued it, or null. */
type Job = { itemKey: string; attempts: number; requestedFor: string[] | null };

async function claim(database: Database, token: string) {
	const { rows } = await database.execute<Job>(sql`
		UPDATE "itemReadingQueue" SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + interval '3 minutes'
		WHERE "itemKey" IN (SELECT "itemKey" FROM "itemReadingQueue"
			WHERE "nextAttemptAt" <= now() AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
			ORDER BY "nextAttemptAt", "itemKey" LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
		RETURNING "itemKey", "attempts", "requestedFor"`);
	return rows;
}

async function recordFacts(database: Database, keys: string[]) {
	const list = keyArray(keys);
	const { rows } = await database.execute<{ key: string; title: string | null; abstractNote: string | null; itemType: string; DOI: string | null; openAlexType: string | null; sources: string[]; pdf: string | null }>(sql`
		SELECT i.key, i.title, i."abstractNote", i."itemType"::text AS "itemType", i."DOI",
			-- OpenAlex's type from the newest snapshot of a source that still holds the record.
			(SELECT s.payload ->> 'type' FROM "sourceSnapshot" s
				JOIN "itemSourceLink" held ON held."itemKey" = s."itemKey" AND held."sourceConnectionKey" = s."sourceConnectionKey" AND NOT held."remoteDeleted"
				WHERE s."itemKey" = i.key AND s.payload ? 'type' ORDER BY s."fetchedAt" DESC LIMIT 1) AS "openAlexType",
			ARRAY(SELECT l."sourceConnectionKey" FROM "itemSourceLink" l WHERE l."itemKey" = i.key AND NOT l."remoteDeleted") AS sources,
			(SELECT left(c."fullTextPDF", ${PDF_CHARS}) FROM "item" c WHERE c."parentItem" = i.key AND coalesce(c.deleted, 0) <> 1 AND c."fullTextPDF" <> ''
				ORDER BY c.key LIMIT 1) AS pdf
		FROM "item" i WHERE i.key = ANY(${list}) AND coalesce(i.deleted, 0) <> 1 AND coalesce(i."parentItem", '') = ''`);
	const readings = await database.execute<NonNullable<Stored["reading"]> & { itemKey: string }>(sql`
		SELECT "itemKey", "contentHash", "questionSet", "studyType", "typedBy", "typeConfidence", "input" FROM "itemReading" WHERE "itemKey" = ANY(${list})`);
	const grades = await database.execute<{ itemKey: string; sourceConnectionKey: string; subjectHash: string; pendingSubjectHash: string | null }>(sql`
		SELECT "itemKey", "sourceConnectionKey", "subjectHash", "pendingSubjectHash" FROM "itemGrade" WHERE "itemKey" = ANY(${list})`);
	return rows.map((row) => ({
		record: {
			key: row.key, title: row.title ?? "", abstract: abstractPlainText(row.abstractNote).slice(0, ABSTRACT_CHARS),
			pdf: (row.pdf ?? "").replace(PDF_PAGE_MARK, "\n").trim(),
			itemType: row.itemType, openAlexType: row.openAlexType, doi: row.DOI, sources: row.sources,
		},
		stored: {
			reading: readings.rows.find((reading) => reading.itemKey === row.key),
			grades: new Map(grades.rows.filter((grade) => grade.itemKey === row.key).map((grade) => [grade.sourceConnectionKey, [grade.subjectHash, grade.pendingSubjectHash]])),
		},
	}));
}

/**
 * Leaves a queued record done with nothing to read, unless it was queued again meanwhile, and decides again in the same
 * transaction whether it is screened out: a source that stopped holding it may have been what let it in.
 */
async function finish(database: Database, key: string, token: string) {
	await database.transaction(async (tx) => {
		const owned = await tx.execute(sql`UPDATE "itemReadingQueue" SET "nextAttemptAt" = NULL, "requestedFor" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
			WHERE "itemKey" = ${key} AND "leaseToken" = ${token} RETURNING "itemKey"`);
		if (owned.rows.length) await refreshScreenedOut(tx, sql`SELECT ${key}::varchar`);
	});
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

/** The screening sources that hold a record, with their subjects. */
const screenedBy = (record: RecordFacts, subjects: Map<string, { subject: string; hash: string }>): Subject[] =>
	record.sources.flatMap((key) => {
		const subject = subjects.get(key);
		return subject ? [{ key, ...subject }] : [];
	});

/**
 * Stores a grade. A grade against the subject the source's current grade was made with replaces it; one against a new
 * subject waits as pending until the source's last record is graded. It is kept only while its source still holds the
 * record: the share lock waits out a withdrawal in flight, whose trigger drops the source's grade.
 */
async function saveGrade(tx: DatabaseTransaction, itemKey: string, subject: Subject, score: number) {
	const same = sql`"itemGrade"."subjectHash" = EXCLUDED."subjectHash"`;
	await tx.execute(sql`INSERT INTO "itemGrade" ("itemKey", "sourceConnectionKey", "score", "grade", "subjectHash", "gradedAt")
		SELECT ${itemKey}, ${subject.key}, ${score}, ${gradeOf(score)}, ${subject.hash}, now()
		WHERE EXISTS (SELECT 1 FROM "itemSourceLink" WHERE "itemKey" = ${itemKey} AND "sourceConnectionKey" = ${subject.key} AND NOT "remoteDeleted" FOR SHARE)
		ON CONFLICT ("itemKey", "sourceConnectionKey") DO UPDATE SET
			"score" = CASE WHEN ${same} THEN EXCLUDED."score" ELSE "itemGrade"."score" END,
			"grade" = CASE WHEN ${same} THEN EXCLUDED."grade" ELSE "itemGrade"."grade" END,
			"pendingScore" = CASE WHEN ${same} THEN NULL ELSE EXCLUDED."score" END,
			"pendingGrade" = CASE WHEN ${same} THEN NULL ELSE EXCLUDED."grade" END,
			"pendingSubjectHash" = CASE WHEN ${same} THEN NULL ELSE EXCLUDED."subjectHash" END,
			"gradedAt" = now()`);
}

/** A type Jev was unsure of from the abstract, of a record with a PDF: it is queued again to be asked from the PDF. */
const askFromPdf = (record: RecordFacts, plan: Plan, read: ReadingAnswers) =>
	Boolean(record.pdf) && !plan.pdf && read.type !== undefined && read.type.confidence < LOW_CONFIDENCE;

/**
 * Stores a read's answers, only while the claim is still this cycle's, so a record queued again during the call is
 * read again instead of taking answers about its older text.
 */
async function saveRead(database: Database, record: RecordFacts, plan: Plan, answer: Awaited<ReturnType<typeof askJev>> | null, job: Job, token: string) {
	const read: ReadingAnswers = answer ? readingAnswers(plan.ask, answer.answers) : { scores: [] };
	await database.transaction(async (tx) => {
		// A record with grades still to ask, a type to ask from its PDF, or another source's request added during the
		// call stays queued for the next one.
		const claimed = job.requestedFor ? sql`${keyArray(job.requestedFor)}::text[]` : sql`NULL::text[]`;
		const stay = sql`(${plan.more || askFromPdf(record, plan, read)} OR "requestedFor" IS DISTINCT FROM ${claimed})`;
		const owned = await tx.execute(sql`UPDATE "itemReadingQueue" SET "nextAttemptAt" = CASE WHEN ${stay} THEN now() END,
			"requestedFor" = CASE WHEN ${stay} THEN "requestedFor" END, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
			WHERE "itemKey" = ${record.key} AND "leaseToken" = ${token} RETURNING "itemKey"`);
		if (!owned.rows.length) return;
		if (!plan.fresh) {
			const row = readingRow(record, plan, read, answer!.model);
			await tx.insert(itemReading).values(row).onConflictDoUpdate({ target: itemReading.itemKey, set: row });
		} else if (plan.retype) {
			await tx.update(itemReading).set({ ...typeFields(plan, read), ...(plan.pdf ? { input: "pdf" as const } : {}) })
				.where(sql`${itemReading.itemKey} = ${record.key}`);
		}
		for (const [index, subject] of plan.graded.entries()) await saveGrade(tx, record.key, subject, read.scores[index]!);
		// Decided with the grades it rests on, so a crash cannot leave the two apart.
		await refreshScreenedOut(tx, sql`SELECT ${record.key}::varchar`);
	});
}

/**
 * What reading a record asks, or null when it is held by no screening source or nothing about it changed. A record an
 * owner's request queued is graded for the requesting sources only.
 */
function planFor(facts: Awaited<ReturnType<typeof recordFacts>>[number], subjects: Map<string, { subject: string; hash: string }>, requestedFor: string[] | null) {
	const screened = screenedBy(facts.record, subjects).filter((subject) => !requestedFor || requestedFor.includes(subject.key));
	return screened.length ? planRead(facts.record, facts.stored, screened) : null;
}

/**
 * Asks Jev what the plan needs, or nothing when a metadata retype is all there is to do. What a call cost is kept as
 * soon as it answers, before its answers are checked, so a paid call whose answers are refused still counts.
 */
async function callJev(
	database: Database, apiKey: string, record: Pick<RecordFacts, "title" | "abstract" | "pdf">, ask: ReadingAsk, withPdf: boolean,
	signal?: AbortSignal, request?: typeof fetch,
) {
	if (!asksJev(ask)) return null;
	const state = { title: record.title, ...(record.abstract ? { abstract: record.abstract } : {}), ...(withPdf ? { fullTextOpening: record.pdf } : {}) };
	const answer = await askJev({ apiKey, state, questions: readingQuestions(ask), signal, request });
	await database.insert(readingSpend).values({ day: new Date().toISOString().slice(0, 10), reads: 1, usd: answer.usd })
		.onConflictDoUpdate({ target: readingSpend.day, set: { reads: sql`${readingSpend.reads} + 1`, usd: sql`${readingSpend.usd} + ${answer.usd}` } });
	return answer;
}

/** Reads one claimed record, when anything about it needs reading, and stores what Jev answered. */
async function readOne(
	database: Database, apiKey: string, subjects: Map<string, { subject: string; hash: string }>,
	facts: Awaited<ReturnType<typeof recordFacts>>[number] | undefined, job: Job, token: string,
	signal?: AbortSignal, request?: typeof fetch,
) {
	const plan = facts ? planFor(facts, subjects, job.requestedFor) : null;
	if (!facts || !plan) return finish(database, job.itemKey, token);
	try {
		await saveRead(database, facts.record, plan, await callJev(database, apiKey, facts.record, plan.ask, plan.pdf, signal, request), job, token);
	} catch (error) {
		await fail(database, job, token, error);
	}
}

/**
 * Leaves every waiting record done without reading it: what was published while nothing screens, or without a key, is
 * read only when the owner asks for it, so turning screening on never spends on its own. An owner's request dropped
 * this way ends, so its source reports those records not graded rather than a grading that never finishes.
 */
async function drain(database: Database) {
	await database.transaction(async (tx) => {
		const { rows } = await tx.execute<{ itemKey: string; requestedFor: string[] | null }>(sql`
			WITH drained AS (
				SELECT "itemKey", "requestedFor" FROM "itemReadingQueue"
				WHERE "nextAttemptAt" IS NOT NULL AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now()) FOR UPDATE
			), done AS (
				UPDATE "itemReadingQueue" q SET "nextAttemptAt" = NULL, "requestedFor" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL
				FROM drained d WHERE q."itemKey" = d."itemKey"
			)
			SELECT "itemKey", "requestedFor" FROM drained`);
		if (!rows.length) return;
		const requested = [...new Set(rows.flatMap((row) => row.requestedFor ?? []))];
		if (requested.length) await tx.execute(sql`UPDATE "sourceScreening" SET "gradingOf" = NULL WHERE "sourceConnectionKey" = ANY(${keyArray(requested)})`);
		await refreshScreenedOut(tx, sql`SELECT unnest(${keyArray(rows.map((row) => row.itemKey))})`);
	});
}

/** Hands back the claims a cycle ran out of time for, so the next cycle takes them at once. */
async function release(database: Database, keys: string[], token: string) {
	if (!keys.length) return;
	await database.execute(sql`UPDATE "itemReadingQueue" SET "leaseToken" = NULL, "leaseExpiresAt" = NULL
		WHERE "itemKey" = ANY(${keyArray(keys)}) AND "leaseToken" = ${token}`);
}

/**
 * Reads the records waiting in the queue, a batch at a time, for up to `CYCLE_MS`; no call starts after that, and the
 * records it did not reach are handed back. Each record is read once by Jev on the library's own key: its study type
 * and details when its text changed, and its grade against each screening source whose subject changed, and is decided
 * again as screened out or not. After the cycle, a source whose records are all graded against its new subject swaps
 * the new grades in. Returns whether it read anything.
 */
export async function runReadingCycle(database: Database, config: LibraryServerConfig, signal?: AbortSignal, request?: typeof fetch) {
	const apiKey = readingKey(config);
	const subjects = screeningSubjects(config);
	if (!apiKey || !subjects.size) {
		await drain(database);
		// Swapping finished grades in needs no key: a cycle that stopped before it is made good here too.
		await settleScreening(database);
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
	// Every cycle, so grades a crashed cycle finished are still swapped in.
	await settleScreening(database);
	return worked;
}

const TRIAL_SIZE = 200;

/** Records by grade, as the source status counts them. */
function gradeCounts(grades: readonly (ScreeningGrade | null)[]) {
	const count = (grade: ScreeningGrade) => grades.filter((candidate) => candidate === grade).length;
	return { about: count("about"), touches: count("touches"), passing: count("passing"), notAbout: count("not-about") };
}

/**
 * Grades 200 of a source's records, picked at random, against a proposed subject, and stores nothing but the spend:
 * their grades now and with it, and how many would change, so the owner sees what a new subject does before saving it.
 */
export async function trySubject(
	database: Database, config: LibraryServerConfig, key: string, subject: string, signal?: AbortSignal, request?: typeof fetch,
) {
	const apiKey = readingKey(config);
	if (!apiKey) return "no_key" as const;
	if (!config.sources.some((source) => source.key === key)) return "not_found" as const;
	const { rows } = await database.execute<{ title: string | null; abstractNote: string | null; grade: ScreeningGrade | null }>(sql`
		SELECT i.title, i."abstractNote", g."grade" FROM "itemSourceLink" l
		JOIN "item" i ON i.key = l."itemKey" AND coalesce(i.deleted, 0) <> 1 AND coalesce(i."parentItem", '') = ''
		LEFT JOIN "itemGrade" g ON g."itemKey" = l."itemKey" AND g."sourceConnectionKey" = l."sourceConnectionKey"
		WHERE l."sourceConnectionKey" = ${key} AND NOT l."remoteDeleted" ORDER BY random() LIMIT ${TRIAL_SIZE}`);
	const ask: ReadingAsk = { type: false, details: false, subjects: [subject] };
	const next: ScreeningGrade[] = [];
	// The first failed call stops the others, so a trial that cannot answer spends no more.
	const failed = new AbortController();
	const stopping = signal ? AbortSignal.any([signal, failed.signal]) : failed.signal;
	let index = 0;
	const calls = await Promise.allSettled(Array.from({ length: Math.min(AT_ONCE, rows.length) }, async () => {
		while (index < rows.length && !stopping.aborted) {
			const at = index++;
			const record = { title: rows[at]!.title ?? "", abstract: abstractPlainText(rows[at]!.abstractNote).slice(0, ABSTRACT_CHARS), pdf: "" };
			try {
				const answer = await callJev(database, apiKey, record, ask, false, stopping, request);
				next[at] = gradeOf(readingAnswers(ask, answer!.answers).scores[0]!);
			} catch (error) {
				failed.abort();
				throw error;
			}
		}
	}));
	const refusal = calls.find((call) => call.status === "rejected");
	if (refusal) throw refusal.reason;
	return {
		size: rows.length,
		now: gradeCounts(rows.map((row) => row.grade)),
		next: gradeCounts(next),
		changed: rows.filter((row, at) => row.grade !== null && row.grade !== next[at]).length,
	};
}
