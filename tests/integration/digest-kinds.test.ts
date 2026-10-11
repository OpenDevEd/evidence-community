import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { libraryConfigSchema } from "@/config/library-config/schema";
import { notificationEdition, notificationItemKind } from "@/db/schema/notifications";
import { generateNotificationEdition, prepareDigestForPeriod, prepareNotificationEditions } from "@/lib/notifications/editions";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [], notifications: { enabled: true, digestCovers: "published", schedule: { frequency: "weekly", weekday: 1, time: "09:00", timezone: "UTC" } }, updatedAt: "2026-09-09T00:00:00Z" });
const period = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };
type Client = { query: (text: string, values?: unknown[]) => Promise<unknown> };

const publication = (client: Client, key: string, title: string, abstract: string | null = null) => client.query(
  `WITH identity AS (INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1))
   INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, date, "abstractNote") VALUES ($1, 'native', $1, 'Report', $2, '2026-08-10', $3)`, [key, title, abstract]);

const STUDY = "A study of attention in classrooms across forty schools. ".repeat(6);
const written = (key: string) => ({ title: "August", summary: "Four publications.", markdown: `## Reading\n\nSee [Mills, 2026](/lib/${key}).`, model: "openai/gpt-6-luna", reasoning: "max" });

/** Stands in for OpenScholar: answers each request with `answer`, and keeps the publications it was sent. */
function openScholar(answer: () => Response) {
  const sent: { key: string; candidate?: boolean; kind?: string }[][] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    sent.push((JSON.parse(String(init?.body)) as { publications: (typeof sent)[number] }).publications);
    return answer();
  });
  return { sent, restore: () => spy.mockRestore() };
}
const marks = (publications: { key: string; candidate?: boolean; kind?: string }[]) => publications.map(entry => [entry.key, entry.candidate, entry.kind ?? null]);

it("marks every likely review, has each read once, keeps what it was read as, and lists each list best first", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    await publication(client, "PUBAAAAA", "Maize under heat", STUDY);
    // None of the likely reviews has an abstract worth ranking, so the study with one is listed above them.
    await publication(client, "PUBAAAAB", "Drought: a systematic review");
    await publication(client, "PUBAAAAC", "Farm incomes after floods", "We pooled forty trials in a meta-analysis.");
    await publication(client, "PUBAAAAD", "A review of my summer");
    const prepared = await prepareDigestForPeriod(db, config, period);
    if (prepared.status !== "queued") throw new Error("The edition was not prepared");
    const edition = async () => (await db.select().from(notificationEdition).where(eq(notificationEdition.id, prepared.editionId)))[0];
    expect(marks((await edition()).publications)).toEqual([["PUBAAAAA", false, null], ["PUBAAAAB", true, null], ["PUBAAAAC", true, null], ["PUBAAAAD", true, null]]);

    const service = openScholar(() => Response.json({ digest: { ...written("PUBAAAAA"), kinds: { PUBAAAAB: "review", PUBAAAAC: "meta-analysis", PUBAAAAD: "study", ZZZZZZZZ: "review" } } }));
    try {
      await generateNotificationEdition(db, config);
      // The library marks every publication, so OpenScholar reads the likely ones and guesses at none.
      expect(marks(service.sent[0])).toEqual([["PUBAAAAA", false, null], ["PUBAAAAB", true, null], ["PUBAAAAC", true, null], ["PUBAAAAD", true, null]]);
      // The answers are kept with each record and on the edition. One for a record it does not list is dropped.
      expect((await db.select().from(notificationItemKind).orderBy(notificationItemKind.itemKey)).map(row => [row.itemKey, row.kind])).toEqual([["PUBAAAAB", "review"], ["PUBAAAAC", "meta-analysis"], ["PUBAAAAD", "study"]]);
      expect(marks((await edition()).publications).map(([key, , kind]) => [key, kind])).toEqual([["PUBAAAAA", null], ["PUBAAAAB", "review"], ["PUBAAAAC", "meta-analysis"], ["PUBAAAAD", "study"]]);
      // A reader sees each list in rank order: the likely review read as a single study takes its place below the study with an abstract.
      const { getDigestEdition } = await import("@/lib/notifications/public");
      await client.query('UPDATE "notificationEdition" SET "publishedAt" = now()');
      const shown = await getDigestEdition(db, config, "en-GB", prepared.editionId);
      expect(shown?.reviews?.keys).toEqual(["PUBAAAAB", "PUBAAAAC"]);
      expect(shown?.keys).toEqual(["PUBAAAAA", "PUBAAAAD"]);

      // Written again, the answers go with the request, so nothing is read twice.
      await prepareDigestForPeriod(db, config, period);
      await generateNotificationEdition(db, config);
      expect(marks(service.sent[1])).toEqual([["PUBAAAAA", false, null], ["PUBAAAAB", true, "review"], ["PUBAAAAC", true, "meta-analysis"], ["PUBAAAAD", true, "study"]]);
    } finally {
      service.restore();
    }
  });
}, 120_000);

it("keeps what was read when the writer fails, so the next attempt has nothing read again", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    await publication(client, "PUBAAAAB", "Drought: a systematic review");
    const prepared = await prepareDigestForPeriod(db, config, period);
    if (prepared.status !== "queued") throw new Error("The edition was not prepared");
    let fail = true;
    const service = openScholar(() => (fail
      ? Response.json({ error: "digest_generation_failed", kinds: { PUBAAAAB: "review" } }, { status: 503 })
      : Response.json({ digest: written("PUBAAAAB") })));
    try {
      await generateNotificationEdition(db, config);
      const [failed] = await db.select().from(notificationEdition).where(eq(notificationEdition.id, prepared.editionId));
      expect(failed).toMatchObject({ attempts: 1, publishedAt: null });
      expect(failed.lastError).toContain("503");
      expect(marks(failed.publications)).toEqual([["PUBAAAAB", true, "review"]]);
      fail = false;
      await client.query('UPDATE "notificationEdition" SET "nextAttemptAt" = now()');
      await generateNotificationEdition(db, config);
      expect(marks(service.sent[1])).toEqual([["PUBAAAAB", true, "review"]]);
      expect((await db.select().from(notificationEdition).where(eq(notificationEdition.id, prepared.editionId)))[0].publishedAt).toBeInstanceOf(Date);
    } finally {
      service.restore();
    }
  });
}, 120_000);

/** A record from OpenAlex, with the work as OpenAlex returned it. */
async function openAlexRecord(client: Client, key: string, title: string, work: object) {
  await client.query(`INSERT INTO "sourceConnection" (key, provider, "scopeKind") VALUES ('openalex-test', 'openalex', 'query') ON CONFLICT DO NOTHING`);
  await client.query(
    `WITH identity AS (INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'openalex-test', $1)),
       link AS (INSERT INTO "itemSourceLink" ("itemKey", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'openalex-test', $1))
     INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, date, "abstractNote") VALUES ($1, 'openalex-test', $1, 'Report', $2, '2026-08-10', $3)`, [key, title, STUDY]);
  await client.query(`INSERT INTO "sourceSnapshot" ("itemKey", "sourceConnectionKey", payload, "payloadHash", "fetchedAt") VALUES ($1, 'openalex-test', $2, 'hash', now())`, [key, JSON.stringify(work)]);
}

it("takes OpenAlex's word that a record may be a review, and leaves a retracted record out", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    await publication(client, "PUBAAAAA", "Maize under heat", STUDY);
    await openAlexRecord(client, "PUBAAAAB", "Trade and the climate", { type: "review" });
    await openAlexRecord(client, "PUBAAAAC", "Rice under heat", { type: "article", is_retracted: true });
    const prepared = await prepareDigestForPeriod(db, config, period);
    expect(prepared).toMatchObject({ status: "queued", publicationCount: 2 });
    const [edition] = await db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest"));
    expect(marks(edition.publications)).toEqual([["PUBAAAAA", false, null], ["PUBAAAAB", true, null]]);
  });
}, 120_000);

it("lists an edition's meta-analyses and reviews apart from its other publications, each with its own pages", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const keys = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}AAAA${"ABCDEFGHJKLMNPQRSTUVWXYZ"[index]}`);
    const reviews = keys("REV", 14);
    const studies = keys("STU", 15);
    for (const key of [...reviews, ...studies]) await publication(client, key, `Publication ${key}`);
    const entry = (key: string, kind?: string) => ({ key, title: `Publication ${key}`, creators: [], date: "2026-08-10", abstract: null, publicationType: "Report", doi: null, ...(kind ? { kind } : {}) });
    // Stored as a digest lists them: reviews first. One was read as a single study, so it belongs with the others.
    const publications = [...reviews.map((key, index) => entry(key, index === 13 ? "study" : index % 2 ? "review" : "meta-analysis")), ...studies.map(key => entry(key))];
    const [edition] = await db.insert(notificationEdition).values({ stream: "digest", windowStart: period.start, windowEnd: period.end, publications: publications as never, publicationCount: 29, title: "August", summary: "Many.", markdown: "Text.", publishedAt: period.end, nextAttemptAt: null }).returning();
    const { getDigestEdition } = await import("@/lib/notifications/public");

    const first = await getDigestEdition(db, config, "en-GB", edition.id);
    expect(first).toMatchObject({ listed: 29, page: 1, pages: 2, reviews: { listed: 13, page: 1, pages: 2 } });
    expect(first?.reviews?.keys).toEqual(reviews.slice(0, 12));
    expect(first?.keys).toEqual([reviews[13], ...studies.slice(0, 11)]);
    // Turning one list's page leaves the other where it was.
    const turned = await getDigestEdition(db, config, "en-GB", edition.id, 1, 2);
    expect(turned?.reviews).toMatchObject({ page: 2, keys: reviews.slice(12, 13) });
    expect(turned?.keys).toEqual(first?.keys);
    expect((await getDigestEdition(db, config, "en-GB", edition.id, 2, 1))?.keys).toEqual(studies.slice(11));

    // An edition with no review is one list, as before.
    await db.update(notificationEdition).set({ publications: studies.map(key => entry(key)) as never }).where(eq(notificationEdition.id, edition.id));
    const plain = await getDigestEdition(db, config, "en-GB", edition.id);
    expect(plain).toMatchObject({ listed: 15, pages: 2 });
    expect(plain).not.toHaveProperty("reviews");
  });
}, 120_000);

it("sends what another digest already had read, and keeps a list that was replaced while the answer was on its way", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    await publication(client, "PUBAAAAB", "Drought: a systematic review");
    // Two periods cover the record, and both digests are listed before either is written.
    const august = await prepareDigestForPeriod(db, config, period);
    const overlap = await prepareDigestForPeriod(db, config, { start: new Date("2026-08-05T00:00:00Z"), end: new Date("2026-09-05T00:00:00Z") });
    if (august.status !== "queued" || overlap.status !== "queued") throw new Error("The editions were not prepared");
    let late = false;
    const service = openScholar(() => Response.json({ digest: { ...written("PUBAAAAB"), kinds: { PUBAAAAB: "review" } } }));
    const answer = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (...request) => {
      if (late) {
        // While OpenScholar writes, the period gains a record and the digest is listed again.
        late = false;
        await publication(client, "PUBAAAAC", "Maize under heat", STUDY);
        await prepareDigestForPeriod(db, config, period);
      }
      return answer(...request);
    });
    try {
      await generateNotificationEdition(db, config);
      await generateNotificationEdition(db, config);
      // The second digest was listed before the record was read, and still sends the answer instead of having it read again.
      expect(marks(service.sent[0])).toEqual([["PUBAAAAB", true, null]]);
      expect(marks(service.sent[1])).toEqual([["PUBAAAAB", true, "review"]]);

      await prepareDigestForPeriod(db, config, period);
      late = true;
      await generateNotificationEdition(db, config);
      const [edition] = await db.select().from(notificationEdition).where(eq(notificationEdition.id, august.editionId));
      // The answer came back for the old list. The new list stands, and waits to be written.
      expect(marks(edition.publications)).toEqual([["PUBAAAAC", false, null], ["PUBAAAAB", true, "review"]]);
      expect(edition.nextAttemptAt).not.toBeNull();
    } finally {
      service.restore();
    }
  });
}, 120_000);

it("keeps a large library's many likely reviews marked, and lists the best publication first whatever it is", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    // 305 likely reviews by title, none with an abstract, and one study whose abstract ranks it above all of them.
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const keys = Array.from({ length: 305 }, (_, index) => `REVAAA${letters[Math.floor(index / 24)]}${letters[index % 24]}`);
    await client.query(
      `WITH keys AS (SELECT unnest($1::text[]) AS key), identity AS (INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") SELECT key, 'native', key FROM keys)
       INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, date) SELECT key, 'native', key, 'Report', 'A review of topic ' || key, '2026-08-10' FROM keys`, [keys]);
    await publication(client, "PUBAAAAA", "Maize under heat", STUDY);
    const prepared = await prepareDigestForPeriod(db, config, period);
    expect(prepared).toMatchObject({ status: "queued", publicationCount: 306 });
    const [edition] = await db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest"));
    const listed = edition.publications.map(entry => entry.key);
    expect(listed).toHaveLength(306);
    expect(listed[0]).toBe("PUBAAAAA");
    // Every likely review is marked, so OpenScholar reads the first 300 and a later digest that lists the rest has them read.
    expect(edition.publications.slice(1).every(entry => entry.candidate === true)).toBe(true);
    expect(listed.slice(1)).toEqual(keys);
  });
}, 120_000);

it("reorders the digests listed before ranked lists, best first, keeping every publication", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await publication(client, "PUBAAAAA", "Maize under heat", STUDY);
    await publication(client, "PUBAAAAB", "Drought: a systematic review");
    await publication(client, "PUBAAAAC", "Rice under heat", STUDY);
    const entry = (key: string, kind?: string) => ({ key, title: `Publication ${key}`, creators: [], date: "2026-08-10", abstract: null, publicationType: "Report", doi: null, candidate: key === "PUBAAAAB", ...(kind ? { kind } : {}) });
    // Stored the old way: the likely review first, though it was read as a single study and has no abstract.
    const stored = [entry("PUBAAAAB", "study"), entry("PUBAAAAC"), entry("PUBAAAAA"), entry("PUBGONEX")];
    const [edition] = await db.insert(notificationEdition).values({ stream: "digest", windowStart: period.start, windowEnd: period.end, publications: stored as never, publicationCount: 4, nextAttemptAt: null }).returning();
    const reorder = readFileSync("drizzle/0081_digest-ranked-order.sql", "utf8").split("--> statement-breakpoint").filter(statement => /^\s*(--.*\n\s*)*UPDATE/.test(statement));
    expect(reorder).toHaveLength(1);
    for (const statement of reorder) await client.query(statement);
    const [after] = await db.select().from(notificationEdition).where(eq(notificationEdition.id, edition.id));
    // The two with an abstract first, then the one without, and a record that is gone last.
    expect(after.publications.map(publication => publication.key)).toEqual(["PUBAAAAA", "PUBAAAAC", "PUBAAAAB", "PUBGONEX"]);
    expect(after.publications).toEqual(expect.arrayContaining(stored));
  });
}, 120_000);
