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

it("lists every likely review first, has each read once, and keeps what it was read as", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    await publication(client, "PUBAAAAA", "Maize under heat", STUDY);
    // Neither has an abstract worth ranking, so only being a likely review puts them ahead of the study.
    await publication(client, "PUBAAAAB", "Drought: a systematic review");
    await publication(client, "PUBAAAAC", "Farm incomes after floods", "We pooled forty trials in a meta-analysis.");
    await publication(client, "PUBAAAAD", "A review of my summer");
    const prepared = await prepareDigestForPeriod(db, config, period);
    if (prepared.status !== "queued") throw new Error("The edition was not prepared");
    const edition = async () => (await db.select().from(notificationEdition).where(eq(notificationEdition.id, prepared.editionId)))[0];
    expect(marks((await edition()).publications)).toEqual([["PUBAAAAB", true, null], ["PUBAAAAC", true, null], ["PUBAAAAD", true, null], ["PUBAAAAA", false, null]]);

    const service = openScholar(() => Response.json({ digest: { ...written("PUBAAAAA"), kinds: { PUBAAAAB: "review", PUBAAAAC: "meta-analysis", PUBAAAAD: "study", ZZZZZZZZ: "review" } } }));
    try {
      await generateNotificationEdition(db, config);
      // The library marks every publication, so OpenScholar reads the likely ones and guesses at none.
      expect(marks(service.sent[0])).toEqual([["PUBAAAAB", true, null], ["PUBAAAAC", true, null], ["PUBAAAAD", true, null], ["PUBAAAAA", false, null]]);
      // The answers are kept with each record and on the edition. One for a record it does not list is dropped.
      expect((await db.select().from(notificationItemKind).orderBy(notificationItemKind.itemKey)).map(row => [row.itemKey, row.kind])).toEqual([["PUBAAAAB", "review"], ["PUBAAAAC", "meta-analysis"], ["PUBAAAAD", "study"]]);
      expect(marks((await edition()).publications).map(([key, , kind]) => [key, kind])).toEqual([["PUBAAAAB", "review"], ["PUBAAAAC", "meta-analysis"], ["PUBAAAAD", "study"], ["PUBAAAAA", null]]);

      // Written again, the answers go with the request, so nothing is read twice. What was read as a single study no longer goes first.
      await prepareDigestForPeriod(db, config, period);
      await generateNotificationEdition(db, config);
      expect(marks(service.sent[1])).toEqual([["PUBAAAAB", true, "review"], ["PUBAAAAC", true, "meta-analysis"], ["PUBAAAAA", false, null], ["PUBAAAAD", true, "study"]]);
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
    expect(marks(edition.publications)).toEqual([["PUBAAAAB", true, null], ["PUBAAAAA", false, null]]);
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
      expect(marks(edition.publications)).toEqual([["PUBAAAAB", true, "review"], ["PUBAAAAC", false, null]]);
      expect(edition.nextAttemptAt).not.toBeNull();
    } finally {
      service.restore();
    }
  });
}, 120_000);
