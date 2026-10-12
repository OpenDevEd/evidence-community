import { createHash } from "node:crypto";
import { eq, sql, type SQL } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { sourceScreening } from "@/db/schema/readings";
import { enqueueItemSearchReprojections } from "@/lib/publication/queue";
import { QUESTION_SET } from "./questions";

type ConfiguredSource = LibraryServerConfig["sources"][number];

export const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export const keyArray = (keys: readonly string[]) => sql`ARRAY[${sql.join(keys.map((key) => sql`${key}`), sql`, `)}]::varchar[]`;

/**
 * What a grade is made against: the subject, and the question set that asks it, so new grading questions make every
 * grade stale the way a new subject does.
 */
const subjectHash = (subject: string) => hash(`${QUESTION_SET}\n${subject}`);

/** The library's own OpenRouter key; without one nothing is read. Readers' AI answers are a switch of their own. */
export function readingKey(config: LibraryServerConfig) {
	return config.ai.providers.find((provider) => provider.enabled && provider.provider === "openrouter")?.apiKey ?? null;
}

const screens = (source: ConfiguredSource) => source.enabled && source.screening.enabled;

/** The subject of each source that screens its records, by source key. */
export function screeningSubjects(config: LibraryServerConfig) {
	return new Map(config.sources.filter(screens)
		.map((source) => [source.key, { subject: source.screening.subject, hash: subjectHash(source.screening.subject) }]));
}

/**
 * Decides again whether each record in `keys` (a query of item keys) is screened out: held by at least one source, and
 * every source holding it screens it and keeps its grade out. A record a source brings in unscreened stays in, and so
 * does one not graded yet; a source removed from the configuration no longer counts. Records that change side are
 * searched again.
 */
export async function refreshScreenedOut(tx: DatabaseTransaction, keys: SQL) {
	const { rows } = await tx.execute<{ itemKey: string; revision: number | null }>(sql`
		WITH holding AS (
			SELECT l."itemKey", l."sourceConnectionKey" FROM "itemSourceLink" l
			JOIN "sourceConnection" c ON c.key = l."sourceConnectionKey" AND c.status <> 'removed'
			WHERE NOT l."remoteDeleted" AND l."itemKey" IN (${keys})
		), decided AS (
			SELECT r."itemKey", (
				EXISTS (SELECT 1 FROM holding l WHERE l."itemKey" = r."itemKey")
				AND NOT EXISTS (SELECT 1 FROM holding l WHERE l."itemKey" = r."itemKey"
					AND NOT EXISTS (SELECT 1 FROM "itemGrade" g JOIN "sourceScreening" s ON s."sourceConnectionKey" = g."sourceConnectionKey"
						WHERE g."itemKey" = l."itemKey" AND g."sourceConnectionKey" = l."sourceConnectionKey" AND g."grade" = ANY(s."keptOut")))
			) AS "out"
			FROM "itemReading" r WHERE r."itemKey" IN (${keys})
		)
		UPDATE "itemReading" r SET "screenedOut" = d."out" FROM decided d
		WHERE r."itemKey" = d."itemKey" AND r."screenedOut" <> d."out"
		RETURNING r."itemKey", (SELECT i.revision FROM "item" i WHERE i.key = r."itemKey") AS revision`);
	const changed = rows.flatMap((row) => row.revision === null ? [] : [{ itemKey: row.itemKey, revision: Number(row.revision) }]);
	if (changed.length) await enqueueItemSearchReprojections(tx, changed, new Date());
}

/**
 * Takes these sources out of the grading requests still waiting: a request is spend on one subject, so a new subject,
 * or screening turned off, ends it. A record no other source's request wants leaves the queue.
 */
async function withdrawRequests(tx: DatabaseTransaction, sources: string[]) {
	await tx.execute(sql`UPDATE "itemReadingQueue" q SET "requestedFor" = w.rest, "nextAttemptAt" = CASE WHEN w.rest IS NULL THEN NULL ELSE q."nextAttemptAt" END
		FROM (SELECT "itemKey", nullif(array(SELECT s FROM unnest("requestedFor") s WHERE s <> ALL(${keyArray(sources)}::text[])), '{}') AS rest
			FROM "itemReadingQueue" WHERE "requestedFor" && ${keyArray(sources)}::text[] AND "nextAttemptAt" IS NOT NULL) w
		WHERE q."itemKey" = w."itemKey" AND (q."leaseExpiresAt" IS NULL OR q."leaseExpiresAt" < now())`);
}

/**
 * Stores each source's screening as the configuration sets it. A source whose kept-out grades changed, or that started
 * or stopped screening, has its records decided again, as do the sources in `alsoDecide`; an owner's request to grade
 * ends when the subject changes.
 */
export async function saveSourceScreening(tx: DatabaseTransaction, sources: LibraryServerConfig["sources"], alsoDecide: readonly string[] = []) {
	const before = new Map((await tx.select().from(sourceScreening)).map((row) => [row.sourceConnectionKey, row]));
	const wanted = new Map(sources.filter(screens).map((source) => [source.key, {
		subject: source.screening.subject, subjectHash: subjectHash(source.screening.subject), keptOut: [...source.screening.keptOut].sort(),
	}]));
	const stopped = [...before.keys()].filter((key) => !wanted.has(key));
	const changed = [...stopped, ...alsoDecide];
	const ended = [...stopped];
	for (const key of stopped) await tx.delete(sourceScreening).where(eq(sourceScreening.sourceConnectionKey, key));
	for (const [key, screening] of wanted) {
		const old = before.get(key);
		if (old?.subject === screening.subject && old.subjectHash === screening.subjectHash && old.keptOut.join() === screening.keptOut.join()) continue;
		await tx.insert(sourceScreening).values({ sourceConnectionKey: key, ...screening })
			.onConflictDoUpdate({ target: sourceScreening.sourceConnectionKey, set: { ...screening, gradingOf: sql`CASE WHEN ${sourceScreening.subjectHash} = ${screening.subjectHash} THEN ${sourceScreening.gradingOf} END` } });
		if (old?.keptOut.join() !== screening.keptOut.join()) changed.push(key);
		if (old && old.subjectHash !== screening.subjectHash) ended.push(key);
	}
	if (ended.length) await withdrawRequests(tx, ended);
	if (changed.length) await refreshScreenedOut(tx, sql`SELECT "itemKey" FROM "itemSourceLink" WHERE "sourceConnectionKey" = ANY(${keyArray(changed)})`);
}

/** A source's records that need a grade against its current subject: neither their grade nor a pending one is. */
const ungradedRecords = (key: string, subjectHash: string) => sql`
	SELECT l."itemKey", i.revision FROM "itemSourceLink" l
	JOIN "item" i ON i.key = l."itemKey" AND coalesce(i.deleted, 0) <> 1 AND coalesce(i."parentItem", '') = ''
	WHERE l."sourceConnectionKey" = ${key} AND NOT l."remoteDeleted"
		AND NOT EXISTS (SELECT 1 FROM "itemGrade" g WHERE g."itemKey" = l."itemKey" AND g."sourceConnectionKey" = l."sourceConnectionKey"
			AND (g."subjectHash" = ${subjectHash} OR g."pendingSubjectHash" = ${subjectHash}))`;

/**
 * Once none of a source's records waits for a grade against its current subject, its pending grades take over in one
 * transaction, so a new subject's grades never show one by one, and the owner's request to grade ends.
 */
export async function settleScreening(database: Database) {
	const { rows } = await database.execute<{ key: string }>(sql`SELECT s."sourceConnectionKey" AS key FROM "sourceScreening" s
		WHERE s."gradingOf" IS NOT NULL OR EXISTS (SELECT 1 FROM "itemGrade" g WHERE g."sourceConnectionKey" = s."sourceConnectionKey" AND g."pendingSubjectHash" IS NOT NULL)`);
	for (const { key } of rows) {
		await database.transaction(async (tx) => {
			// The lock holds the subject still while the grades are checked and swapped; a new subject waits for it.
			const [source] = await tx.select().from(sourceScreening).where(eq(sourceScreening.sourceConnectionKey, key)).for("update");
			if (!source) return;
			const waiting = await tx.execute(sql`SELECT 1 FROM (${ungradedRecords(key, source.subjectHash)}) w LIMIT 1`);
			if (waiting.rows.length) return;
			await tx.execute(sql`UPDATE "itemGrade" SET "score" = "pendingScore", "grade" = "pendingGrade", "subjectHash" = "pendingSubjectHash",
				"pendingScore" = NULL, "pendingGrade" = NULL, "pendingSubjectHash" = NULL
				WHERE "sourceConnectionKey" = ${key} AND "pendingSubjectHash" = ${source.subjectHash}`);
			await tx.update(sourceScreening).set({ gradingOf: null }).where(eq(sourceScreening.sourceConnectionKey, key));
			await refreshScreenedOut(tx, sql`SELECT "itemKey" FROM "itemSourceLink" WHERE "sourceConnectionKey" = ${key}`);
		});
	}
}

/**
 * Queues every record of a screening source not graded against its current subject, on the owner's request: the
 * records it held before it screened, and all of them after a new subject. Reading them is the owner's spend to start.
 */
export async function requestGrading(database: Database, config: LibraryServerConfig, key: string) {
	const source = config.sources.find((candidate) => candidate.key === key);
	if (!source || !screens(source)) return "not_screening" as const;
	if (!readingKey(config)) return "no_key" as const;
	const current = subjectHash(source.screening.subject);
	return database.transaction(async (tx) => {
		// The workers store a new configuration when they start with it; until then this subject is not the source's.
		const [stored] = await tx.select().from(sourceScreening).where(eq(sourceScreening.sourceConnectionKey, key)).for("update");
		if (stored?.subjectHash !== current) return "not_ready" as const;
		const [{ ungraded }] = (await tx.execute<{ ungraded: number }>(sql`SELECT count(*)::int AS ungraded FROM (${ungradedRecords(key, current)}) w`)).rows;
		// A record done with is queued for this source alone. One still waiting keeps its place, lease and retries, so a
		// retried request never drops a read in flight: it adds this source to the request that queued it, or reads every
		// source anyway when it waits for its own reasons.
		await tx.execute(sql`
			INSERT INTO "itemReadingQueue" ("itemKey", "revision", "requestedFor") SELECT "itemKey", revision, ARRAY[${key}]::text[] FROM (${ungradedRecords(key, current)}) w
			ON CONFLICT ("itemKey") DO UPDATE SET
				"requestedFor" = CASE WHEN "itemReadingQueue"."nextAttemptAt" IS NULL THEN EXCLUDED."requestedFor"
					WHEN "itemReadingQueue"."requestedFor" IS NULL THEN NULL
					ELSE array(SELECT DISTINCT unnest("itemReadingQueue"."requestedFor" || EXCLUDED."requestedFor")) END,
				"attempts" = CASE WHEN "itemReadingQueue"."nextAttemptAt" IS NULL THEN 0 ELSE "itemReadingQueue"."attempts" END,
				"lastError" = CASE WHEN "itemReadingQueue"."nextAttemptAt" IS NULL THEN NULL ELSE "itemReadingQueue"."lastError" END,
				"nextAttemptAt" = coalesce("itemReadingQueue"."nextAttemptAt", now())`);
		// A retry while grading runs keeps the count it started with, so progress never goes back.
		if (stored.gradingOf === null) await tx.update(sourceScreening).set({ gradingOf: ungraded || null }).where(eq(sourceScreening.sourceConnectionKey, key));
		return { queued: ungraded };
	});
}

type ByGrade<T> = { about: T; touches: T; passing: T; notAbout: T };

/**
 * What a screening source's report says: the subject it screens against, its records by grade with a recently graded
 * title for each, those not graded against its subject, progress while the owner's request runs, and, while records
 * wait to be read, the latest one read and how many are left.
 */
export type ScreeningStatus = {
	subject: string;
	grades: ByGrade<number>;
	examples: ByGrade<string | null>;
	ungraded: number;
	grading: { done: number; of: number } | null;
	reading: { title: string; left: number } | null;
};

/** Titles go into a report OpenScholar keeps; this many characters say what a record is. */
const TITLE_CHARS = 300;
const GRADE_COLUMNS = { about: "about", touches: "touches", passing: "passing", notAbout: "not-about" } as const;

/** The title of the source's most recently graded record, of one grade or of any. */
const latestTitle = (grade: string | null) => sql`(SELECT left(i.title, ${TITLE_CHARS}) FROM "itemGrade" g JOIN "item" i ON i.key = g."itemKey"
	WHERE g."sourceConnectionKey" = s."sourceConnectionKey" ${grade === null ? sql`` : sql`AND g."grade" = ${grade}`} AND coalesce(i.deleted, 0) <> 1
	ORDER BY g."gradedAt" DESC LIMIT 1)`;

/** The screening report of each source that screens, by source key. */
export async function readScreeningStatuses(database: Pick<Database, "execute">) {
	type Row = ByGrade<number> & { key: string; subject: string; gradingOf: number | null; ungraded: number; left: number; latest: string | null }
		& { [Example in `${keyof ByGrade<number>}Example`]: string | null };
	const { rows } = await database.execute<Row>(sql`
		SELECT s."sourceConnectionKey" AS key, s."subject", s."gradingOf",
			${sql.join(Object.entries(GRADE_COLUMNS).map(([column, grade]) => sql`${latestTitle(grade)} AS ${sql.identifier(`${column}Example`)}`), sql`, `)},
			${latestTitle(null)} AS latest,
			-- Records of the source waiting for their first try: the reading under way.
			(SELECT count(*) FROM "itemReadingQueue" q JOIN "itemSourceLink" w ON w."itemKey" = q."itemKey" AND NOT w."remoteDeleted"
				WHERE w."sourceConnectionKey" = s."sourceConnectionKey" AND q."nextAttemptAt" IS NOT NULL AND q."attempts" = 0)::int AS "left",
			count(g."itemKey") FILTER (WHERE g."grade" = 'about')::int AS about,
			count(g."itemKey") FILTER (WHERE g."grade" = 'touches')::int AS touches,
			count(g."itemKey") FILTER (WHERE g."grade" = 'passing')::int AS passing,
			count(g."itemKey") FILTER (WHERE g."grade" = 'not-about')::int AS "notAbout",
			count(l."itemKey") FILTER (WHERE g."itemKey" IS NULL
				OR (g."subjectHash" IS DISTINCT FROM s."subjectHash" AND g."pendingSubjectHash" IS DISTINCT FROM s."subjectHash"))::int AS ungraded
		FROM "sourceScreening" s
		LEFT JOIN "itemSourceLink" l ON l."sourceConnectionKey" = s."sourceConnectionKey" AND NOT l."remoteDeleted"
			AND EXISTS (SELECT 1 FROM "item" i WHERE i.key = l."itemKey" AND coalesce(i.deleted, 0) <> 1 AND coalesce(i."parentItem", '') = '')
		LEFT JOIN "itemGrade" g ON g."itemKey" = l."itemKey" AND g."sourceConnectionKey" = l."sourceConnectionKey"
		GROUP BY s."sourceConnectionKey", s."subject", s."gradingOf"`);
	return new Map(rows.map((row): [string, ScreeningStatus] => [row.key, {
		subject: row.subject,
		grades: { about: row.about, touches: row.touches, passing: row.passing, notAbout: row.notAbout },
		examples: { about: row.aboutExample, touches: row.touchesExample, passing: row.passingExample, notAbout: row.notAboutExample },
		ungraded: row.ungraded,
		grading: row.gradingOf === null ? null : { done: Math.max(0, row.gradingOf - row.ungraded), of: row.gradingOf },
		reading: row.left > 0 && row.latest !== null ? { title: row.latest, left: row.left } : null,
	}]));
}
