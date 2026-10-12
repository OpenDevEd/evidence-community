import { and, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { notificationDelivery, notificationEdition, notificationEditionEvent, notificationSubscriber } from "@/db/schema/notifications";
import { item } from "@/db/schema/tables/item";
import { AdminValidationError } from "@/lib/admin/errors";
import { ItemMutationConflictError, ItemNotFoundError } from "@/lib/admin/native-item-service";
import { publicParentVisibility } from "@/lib/public-item-visibility";
import { checkedDigestDraft, citedKeys, digestDraftSchema } from "./digest-text";
import { getNextDigestEdition } from "./public";
import { digestPeriod } from "./schedule";
import type { DigestDraft, DigestEventKind, DigestPerson, DigestSigner } from "./types";

/**
 * A digest in the admin. AI writes it; the library's team reads it, changes it, and an Editor or Owner publishes it.
 * It follows a record's rule: what readers see changes only when it is published. Until then a change is a draft,
 * which a Creator sends for review. One draft is shared by everyone, and every change carries the revision it was
 * made from, so two people never overwrite each other unseen.
 */

export type DigestActor = DigestPerson & { role: "owner" | "editor" | "creator" };
type Edition = typeof notificationEdition.$inferSelect;
type Words = Required<DigestDraft>;

/** Where an edition stands: AI is writing it, it could not be written, it has unpublished text, or readers have it. */
export type DigestState = "writing" | "failed" | "draft" | "review" | "published";
const PAGE_SIZE = 20;
const PAPERS_PAGE_SIZE = 5;
const digest = eq(notificationEdition.stream, "digest");

function editionState(edition: Pick<Edition, "draft" | "reviewRequestedAt" | "publishedAt" | "nextAttemptAt">): DigestState {
  if (edition.draft) return edition.reviewRequestedAt ? "review" : "draft";
  if (edition.publishedAt) return "published";
  return edition.nextAttemptAt ? "writing" : "failed";
}

/** What readers have, when the edition is published. */
function publishedWords(edition: Edition): Words | null {
  return edition.publishedAt ? { title: edition.title ?? "", summary: edition.summary ?? "", markdown: edition.markdown ?? "", note: edition.note ?? "" } : null;
}
/** The text the team is working on: the draft, or failing that what readers have. */
function workingWords(edition: Edition): Words | null {
  return edition.draft ? { ...edition.draft, note: edition.draft.note ?? edition.note ?? "" } : publishedWords(edition);
}
const sameWords = (a: Words, b: Words) => a.title === b.title && a.summary === b.summary && a.markdown === b.markdown && a.note === b.note;
/**
 * A draft a person has changed, which a rewrite must not replace: it no longer reads as AI wrote it, or it carries a
 * note of its own. On an edition readers have, a draft that reads as AI wrote it is either a rewrite nobody has
 * touched or a person's choice to go back to AI's words. The history tells them apart: a person edited it since AI wrote.
 */
export async function draftIsEdited(tx: DatabaseTransaction, edition: Pick<Edition, "id" | "draft" | "ai" | "note" | "publishedAt">) {
  const { draft, ai } = edition;
  if (!draft) return false;
  if (!ai || draft.title !== ai.title || draft.summary !== ai.summary || draft.markdown !== ai.markdown || (draft.note ?? edition.note ?? "") !== (edition.note ?? "")) return true;
  if (!edition.publishedAt) return false;
  const [last] = await tx.select({ kind: notificationEditionEvent.kind }).from(notificationEditionEvent)
    .where(and(eq(notificationEditionEvent.editionId, edition.id), inArray(notificationEditionEvent.kind, ["written", "edited"])))
    .orderBy(desc(notificationEditionEvent.at), desc(notificationEditionEvent.id)).limit(1);
  return last?.kind === "edited";
}

export async function recordDigestEvent(tx: DatabaseTransaction, editionId: string, kind: DigestEventKind, actor: DigestPerson | null) {
  await tx.insert(notificationEditionEvent).values({ editionId, kind, actor });
}

/**
 * Every subscriber who had confirmed their address by `asOf` gets the edition, once. An edition sent as it is written
 * goes to the readers its period ended with; one a person publishes later goes to the readers there are then.
 */
export async function queueEditionDeliveries(tx: DatabaseTransaction, edition: Pick<Edition, "id" | "stream" | "windowEnd">, asOf = edition.windowEnd) {
  await tx.execute(sql`
    INSERT INTO "notificationDelivery" ("messageKey", "subscriberId", "editionId")
    SELECT ${edition.id} || ':' || "id"::text, "id", ${edition.id}::uuid FROM "notificationSubscriber"
    WHERE "confirmedAt" IS NOT NULL AND "confirmedAt" <= ${asOf}
      AND (CASE WHEN ${edition.stream} = 'digest' THEN "digest" ELSE "instant" END)
    ON CONFLICT DO NOTHING
  `);
}

/** When an edition is dated, and its period as the team reads it: "September 2026" for a calendar month, else the first and last day it covers. */
const when = (config: LibraryServerConfig, edition: Pick<Edition, "windowStart" | "windowEnd">) => {
  const timeZone = config.notifications.schedule.timezone;
  const end = (options: Intl.DateTimeFormatOptions) => edition.windowEnd.toLocaleDateString("en-GB", { ...options, timeZone });
  return { day: end({ day: "numeric" }), month: end({ month: "short" }), date: end({ day: "numeric", month: "long", year: "numeric" }), period: digestPeriod(edition.windowStart, edition.windowEnd, config.notifications.digestCovers, timeZone, "en-GB").label };
};

type AdminDigestRow = { id: string; day: string; month: string; date: string; period: string; publicationCount: number; title: string | null; state: DigestState; checkedBy: DigestPerson | null };
export type AdminDigestsQuery = { page: number; show: "all" | "draft" | "review" | "published"; sort: "newest" | "oldest" };

const hasDraft = isNotNull(notificationEdition.draft);
const SHOWN = {
  all: sql`true`,
  draft: and(hasDraft, isNull(notificationEdition.reviewRequestedAt))!,
  review: and(hasDraft, isNotNull(notificationEdition.reviewRequestedAt))!,
  published: and(isNull(notificationEdition.draft), isNotNull(notificationEdition.publishedAt))!,
} satisfies Record<AdminDigestsQuery["show"], SQL>;

/** The editions a page at a time, narrowed to where they stand, with how many stand where. `review` is how many wait for an Editor or Owner. */
export async function listAdminDigests(db: Database, config: LibraryServerConfig, query: AdminDigestsQuery = { page: 1, show: "all", sort: "newest" }) {
  const [counts] = await db.select({
    all: count(), draft: sql<number>`count(*) FILTER (WHERE ${SHOWN.draft})::int`, review: sql<number>`count(*) FILTER (WHERE ${SHOWN.review})::int`,
    published: sql<number>`count(*) FILTER (WHERE ${SHOWN.published})::int`,
  }).from(notificationEdition).where(digest);
  const total = counts[query.show];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page), pages);
  // Lists read the small columns only, never an edition's stored publications.
  const rows = await db.select({
    id: notificationEdition.id, windowStart: notificationEdition.windowStart, windowEnd: notificationEdition.windowEnd, publicationCount: notificationEdition.publicationCount,
    title: notificationEdition.title, draft: notificationEdition.draft, reviewRequestedAt: notificationEdition.reviewRequestedAt, publishedAt: notificationEdition.publishedAt,
    nextAttemptAt: notificationEdition.nextAttemptAt, checkedBy: notificationEdition.checkedBy,
  }).from(notificationEdition).where(and(digest, SHOWN[query.show]))
    .orderBy(query.sort === "oldest" ? notificationEdition.windowEnd : desc(notificationEdition.windowEnd)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  const editions: AdminDigestRow[] = rows.map(row => ({
    id: row.id, ...when(config, row), publicationCount: row.publicationCount, title: row.draft?.title ?? row.title, state: editionState(row), checkedBy: row.checkedBy,
  }));
  return { editions, page, pages, total, counts, overview: await digestOverview(db, config) };
}

/** What the library's digests are set to do: when the next one is due, or that they are paused or off, and how many readers get them. */
async function digestOverview(db: Database, config: LibraryServerConfig) {
  const [next, [{ subscribers }]] = await Promise.all([
    getNextDigestEdition(db, config, "en-GB"),
    db.select({ subscribers: count() }).from(notificationSubscriber).where(and(isNotNull(notificationSubscriber.confirmedAt), eq(notificationSubscriber.digest, true))),
  ]);
  return {
    sending: config.notifications.enabled,
    paused: config.notifications.enabled && config.notifications.pausedSince !== null,
    approval: config.notifications.approval,
    attribution: config.notifications.attribution,
    next: next && { day: next.weekday, time: next.time },
    subscribers,
  };
}

export type AdminDigest = Awaited<ReturnType<typeof readAdminDigest>>;

/** One edition as the team works on it: the text in hand, what readers have, what AI wrote, and what happened so far. */
export async function readAdminDigest(db: Database | DatabaseTransaction, config: LibraryServerConfig, id: string) {
  const [edition] = await db.select().from(notificationEdition).where(and(digest, eq(notificationEdition.id, id)));
  if (!edition) throw new ItemNotFoundError(id);
  const [events, [sent]] = await Promise.all([
    db.select().from(notificationEditionEvent).where(eq(notificationEditionEvent.editionId, id)).orderBy(notificationEditionEvent.at, notificationEditionEvent.id),
    db.select({ readers: count(), at: sql<Date | null>`max(${notificationDelivery.sentAt})` }).from(notificationDelivery)
      .where(and(eq(notificationDelivery.editionId, id), eq(notificationDelivery.status, "sent"))),
  ]);
  const published = publishedWords(edition);
  return {
    id: edition.id, ...when(config, edition), publicationCount: edition.publicationCount,
    state: editionState(edition),
    // A published digest can be waiting for AI to write it again.
    writing: edition.nextAttemptAt !== null,
    revision: edition.draftRevision,
    words: workingWords(edition),
    // Why the edition has no text, when the writer gave up on it.
    error: edition.nextAttemptAt === null && !edition.ai && !edition.publishedAt ? edition.lastError : null,
    published,
    publishedAt: edition.publishedAt?.toISOString() ?? null,
    // An edition the older runtime published during an update has no record of AI's text: while nobody has checked it, what readers have is AI's.
    ai: edition.ai ?? (published && !edition.checkedBy ? { title: published.title, summary: published.summary, markdown: published.markdown } : null),
    checkedBy: edition.checkedBy,
    // Whether readers are told who checked it, and so whether they see the editor's note.
    attribution: config.notifications.attribution,
    events: events.map(event => ({ kind: event.kind, at: event.at.toISOString(), actor: event.actor })),
    sent: sent.readers ? { readers: sent.readers, at: new Date(sent.at!).toISOString() } : null,
  };
}

async function lockEdition(tx: DatabaseTransaction, id: string, expectedRevision: number) {
  const [edition] = await tx.select().from(notificationEdition).where(and(digest, eq(notificationEdition.id, id))).for("update");
  if (!edition) throw new ItemNotFoundError(id);
  // Someone else saved or moved the edition since this person loaded it.
  if (edition.draftRevision !== expectedRevision) throw new ItemMutationConflictError(id);
  if (edition.nextAttemptAt !== null) throw new AdminValidationError("AI is writing this digest. Try again when it is done.");
  return edition;
}

/** Every citation must be one of the edition's publications, and one readers can open. */
async function assertCitationsPublic(tx: DatabaseTransaction, config: LibraryServerConfig, edition: Pick<Edition, "publications">, markdown: string) {
  const keys = citedKeys(markdown);
  if (!keys.length) return;
  const listed = new Set(edition.publications.map(publication => publication.key));
  const outside = keys.filter(key => !listed.has(key));
  if (outside.length) {
    const message = `${outside.length === 1 ? "A citation points" : `${outside.length} citations point`} to a publication that is not in this digest: ${outside.join(", ")}.`;
    throw new AdminValidationError(message, { markdown: message });
  }
  const found = await tx.select({ key: item.key }).from(item).where(and(inArray(item.key, keys), publicParentVisibility(tx, config.content.tags.hidden)));
  const missing = keys.filter(key => !found.some(row => row.key === key));
  if (missing.length) {
    const message = `${missing.length === 1 ? "A citation points" : `${missing.length} citations point`} to a publication readers cannot open: ${missing.join(", ")}.`;
    throw new AdminValidationError(message, { markdown: message });
  }
}

/** Saves the team's text as the draft. Text that matches what readers already have leaves no draft behind. */
export async function saveDigestDraft(db: Database, config: LibraryServerConfig, input: { id: string; expectedRevision: number; words: unknown }, actor: DigestActor) {
  const words = checkedDigestDraft(input.words);
  return db.transaction(async tx => {
    const edition = await lockEdition(tx, input.id, input.expectedRevision);
    const current = workingWords(edition);
    if (!current) throw new AdminValidationError("This digest has no text to change yet.");
    await assertCitationsPublic(tx, config, edition, words.markdown);
    const published = publishedWords(edition);
    const unchanged = published !== null && sameWords(words, published);
    await tx.update(notificationEdition).set({
      draft: unchanged ? null : words, draftRevision: edition.draftRevision + 1, ...(unchanged ? { reviewRequestedAt: null } : {}),
    }).where(eq(notificationEdition.id, edition.id));
    if (!sameWords(words, current)) await recordEdit(tx, edition.id, actor);
    return readAdminDigest(tx, config, edition.id);
  });
}

/** A run of saves by one person is one step in the history, timed at the last of them. */
async function recordEdit(tx: DatabaseTransaction, editionId: string, actor: DigestActor) {
  const [last] = await tx.select().from(notificationEditionEvent).where(eq(notificationEditionEvent.editionId, editionId))
    .orderBy(desc(notificationEditionEvent.at), desc(notificationEditionEvent.id)).limit(1);
  if (last?.kind === "edited" && last.actor?.id === actor.id) await tx.update(notificationEditionEvent).set({ at: new Date() }).where(eq(notificationEditionEvent.id, last.id));
  else await recordDigestEvent(tx, editionId, "edited", person(actor));
}
const person = ({ id, name, photo }: DigestActor): DigestPerson => ({ id, name, photo });
/** Only an Editor or Owner publishes, so only they sign. */
function signer(actor: DigestActor): DigestSigner {
  if (actor.role === "creator") throw new AdminValidationError("Only an Editor or Owner can publish a digest.");
  return { ...person(actor), role: actor.role };
}

export type DigestAction = "submit" | "withdraw" | "return" | "publish";

function requirePublisher(actor: DigestActor, what: string) {
  if (actor.role === "creator") throw new AdminValidationError(`Only an Editor or Owner can ${what}.`);
}

async function submittedBy(tx: DatabaseTransaction, editionId: string) {
  const [last] = await tx.select({ actor: notificationEditionEvent.actor }).from(notificationEditionEvent)
    .where(and(eq(notificationEditionEvent.editionId, editionId), eq(notificationEditionEvent.kind, "submitted")))
    .orderBy(desc(notificationEditionEvent.at), desc(notificationEditionEvent.id)).limit(1);
  return last?.actor?.id ?? null;
}

/** What each step requires and changes, apart from publishing. */
async function reviewStep(tx: DatabaseTransaction, edition: Edition, action: Exclude<DigestAction, "publish">, actor: DigestActor): Promise<{ reviewRequestedAt: Date | null; event: DigestEventKind }> {
  const inReview = edition.reviewRequestedAt !== null;
  if (action === "submit") {
    if (inReview) throw new AdminValidationError("This digest is already waiting for review.");
    return { reviewRequestedAt: new Date(), event: "submitted" };
  }
  if (!inReview) throw new AdminValidationError("This digest is not waiting for review.");
  if (action === "return") {
    requirePublisher(actor, "send a digest back");
    return { reviewRequestedAt: null, event: "returned" };
  }
  if (actor.role === "creator" && await submittedBy(tx, edition.id) !== actor.id) throw new AdminValidationError("You can only take back a digest you sent for review.");
  return { reviewRequestedAt: null, event: "withdrawn" };
}

/**
 * Publishes the draft: readers now see it, signed by the person who published it. The first time an edition is
 * published it is emailed, unless it was written by hand for a past period; publishing changes to an edition readers
 * already have sends nothing.
 */
async function publishDraft(tx: DatabaseTransaction, config: LibraryServerConfig, edition: Edition, actor: DigestActor) {
  const checkedBy = signer(actor);
  // The text was checked when a person saved it; what AI wrote went through the writer's own checks.
  const words = digestDraftSchema.parse(workingWords(edition));
  await assertCitationsPublic(tx, config, edition, words.markdown);
  const { note, ...text } = words;
  // The older runtime kept no record of AI's text. Before a person's text replaces what it published unchecked, that text is kept as AI's.
  const before = publishedWords(edition);
  const ai = edition.ai ?? (before && !edition.checkedBy ? { title: before.title, summary: before.summary, markdown: before.markdown } : null);
  await tx.update(notificationEdition).set({
    ...text, note: note || null, ai, draft: null, reviewRequestedAt: null, checkedBy,
    publishedAt: edition.publishedAt ?? new Date(), draftRevision: edition.draftRevision + 1,
  }).where(eq(notificationEdition.id, edition.id));
  if (!edition.publishedAt && !edition.silent) await queueEditionDeliveries(tx, edition, new Date());
  await recordDigestEvent(tx, edition.id, "published", person(actor));
}

/** Moves a draft along: sent for review, taken back, sent back, or published. */
export async function moveDigest(db: Database, config: LibraryServerConfig, input: { id: string; expectedRevision: number; action: DigestAction }, actor: DigestActor) {
  return db.transaction(async tx => {
    const edition = await lockEdition(tx, input.id, input.expectedRevision);
    if (!edition.draft) throw new AdminValidationError("This digest has no changes to publish.");
    if (input.action === "publish") await publishDraft(tx, config, edition, actor);
    else {
      const step = await reviewStep(tx, edition, input.action, actor);
      await tx.update(notificationEdition).set({ reviewRequestedAt: step.reviewRequestedAt, draftRevision: edition.draftRevision + 1 }).where(eq(notificationEdition.id, edition.id));
      await recordDigestEvent(tx, edition.id, step.event, person(actor));
    }
    return readAdminDigest(tx, config, edition.id);
  });
}

export type DigestPaper = { key: string; label: string; title: string; date: string | null; review: boolean };
export type DigestPapersQuery = { query: string; show: "all" | "reviews" | "uncited"; sort: "newest" | "title" | "author"; page: number; cited: string[] };

// A stored creator is a name as the source gives it, so the surname is its last word.
const surname = sql`coalesce(substring(stored.entry->'creators'->>0 from '(\\S+)\\s*$'), '')`;
const SORTS: Record<DigestPapersQuery["sort"], SQL> = {
  newest: sql`stored.entry->>'date' DESC NULLS LAST, stored.position`,
  title: sql`lower(stored.entry->>'title'), stored.position`,
  author: sql`lower(${surname}), stored.position`,
};

/** "Terzi, 2026", "Abebaw and Feleke, 2026" or "Phong et al., 2026": how a citation names its paper. */
function citationLabel(creators: readonly unknown[], date: string | null) {
  // Stored publications come from many releases and sources, so a creator that is not a name is passed over.
  const names = creators.map(name => (typeof name === "string" ? name.trim().split(/\s+/).at(-1) ?? "" : "")).filter(Boolean);
  const who = names.length === 0 ? "Unknown" : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} et al.`;
  const year = /^\d{4}/.exec(date ?? "")?.[0];
  return year ? `${who}, ${year}` : who;
}

/** The edition's publications with these keys, for naming the ones the text cites. At most a hundred. */
export async function getDigestPapers(db: Database, config: LibraryServerConfig, id: string, keys: string[]) {
  if (!keys.length) return { papers: [] as DigestPaper[] };
  const wanted = sql`ARRAY[${sql.join(keys.slice(0, 100).map(key => sql`${key}`), sql`, `)}]::text[]`;
  const { rows } = await db.execute<{ key: string; title: string; creators: unknown; date: string | null; review: boolean }>(sql`
    SELECT stored.entry->>'key' AS key, stored.entry->>'title' AS title, stored.entry->'creators' AS creators, stored.entry->>'date' AS date, coalesce(stored.entry->>'kind' IN ('meta-analysis', 'review'), false) AS review
    FROM ${notificationEdition}, jsonb_array_elements(${notificationEdition.publications}) AS stored(entry)
    WHERE ${notificationEdition.id} = ${id} AND ${digest} AND stored.entry->>'key' = ANY(${wanted})`);
  return { papers: rows.map((row): DigestPaper => ({ key: row.key, label: citationLabel(Array.isArray(row.creators) ? row.creators : [], row.date), title: row.title, date: row.date, review: row.review })) };
}

/**
 * A page of the edition's publications to cite from: searched by title and author, narrowed to reviews or to those the
 * text leaves out, and sorted. Only publications readers can open now are offered. `cited` is the text as the editor
 * has it, which may not be saved yet.
 */
export async function listDigestPapers(db: Database, config: LibraryServerConfig, id: string, query: DigestPapersQuery) {
  const words = query.query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const matches = and(...words.map(word => sql`lower((stored.entry->>'title') || ' ' || (stored.entry->'creators')::text) LIKE ${`%${word.replace(/[\\%_]/g, "\\$&")}%`}`));
  const review = sql`stored.entry->>'kind' IN ('meta-analysis', 'review')`;
  const uncited = query.cited.length ? sql`NOT (stored.entry->>'key' = ANY(${sql`ARRAY[${sql.join(query.cited.map(key => sql`${key}`), sql`, `)}]::text[]`}))` : sql`true`;
  const listed = sql`
    FROM ${notificationEdition}, jsonb_array_elements(${notificationEdition.publications}) WITH ORDINALITY AS stored(entry, position)
    JOIN ${item} ON ${item.key} = stored.entry->>'key'
    WHERE ${notificationEdition.id} = ${id} AND ${digest} AND ${publicParentVisibility(db, config.content.tags.hidden)} AND ${matches ?? sql`true`}`;
  const { rows: [counts] } = await db.execute<{ all: number; reviews: number; uncited: number }>(sql`
    SELECT count(*)::int AS "all", count(*) FILTER (WHERE ${review})::int AS reviews, count(*) FILTER (WHERE ${uncited})::int AS uncited ${listed}`);
  const total = counts[query.show];
  const pages = Math.max(1, Math.ceil(total / PAPERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page), pages);
  const shown = query.show === "reviews" ? review : query.show === "uncited" ? uncited : sql`true`;
  const { rows } = await db.execute<{ key: string; title: string; creators: unknown; date: string | null; review: boolean }>(sql`
    SELECT stored.entry->>'key' AS key, stored.entry->>'title' AS title, stored.entry->'creators' AS creators, stored.entry->>'date' AS date, coalesce(${review}, false) AS review
    ${listed} AND ${shown} ORDER BY ${SORTS[query.sort]} LIMIT ${PAPERS_PAGE_SIZE} OFFSET ${(page - 1) * PAPERS_PAGE_SIZE}`);
  const papers: DigestPaper[] = rows.map(row => ({ key: row.key, label: citationLabel(Array.isArray(row.creators) ? row.creators : [], row.date), title: row.title, date: row.date, review: row.review }));
  return { papers, page, pages, total, counts };
}
