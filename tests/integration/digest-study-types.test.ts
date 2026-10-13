import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { libraryConfigSchema } from "@/config/library-config/schema";
import { notificationEdition } from "@/db/schema/notifications";
import { generateNotificationEdition, prepareDigestForPeriod, prepareNotificationEditions } from "@/lib/notifications/editions";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [], notifications: { enabled: true, digestCovers: "published", schedule: { frequency: "weekly", weekday: 1, time: "09:00", timezone: "UTC" } }, updatedAt: "2026-09-09T00:00:00Z" });
const period = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };
type Client = { query: (text: string, values?: unknown[]) => Promise<unknown> };

const publication = (client: Client, key: string, title: string, abstract: string | null = null) => client.query(
  `WITH identity AS (INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1))
   INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, date, "abstractNote") VALUES ($1, 'native', $1, 'Report', $2, '2026-08-10', $3)`, [key, title, abstract]);
/** What Jev read a record as. */
const read = (client: Client, key: string, type: string) => client.query(
  `INSERT INTO "itemReading" ("itemKey", "studyType", "typeConfidence", "typedBy", "pooled", "region", "effects", "input", "contentHash", "questionSet", "model")
   VALUES ($1, $2, 0.9, 'ai', 0.1, 'sub-saharan-africa', 0.5, 'abstract', 'test', 1, 'typesafe/jev-1.13')`, [key, type]);

const STUDY = "A study of attention in classrooms across forty schools. ".repeat(6);
const written = (key: string) => ({ title: "August", summary: "Four publications.", markdown: `## Reading\n\nSee [Mills, 2026](/lib/${key}).`, model: "openai/gpt-6-luna", reasoning: "max" });

it("lists reviews and syntheses first by study type, counts the period by type, and sends each publication's type", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    await publication(client, "PUBAAAAA", "Maize under heat", STUDY);
    await read(client, "PUBAAAAA", "rct");
    // A systematic review with no abstract still comes before the trial: reviews and syntheses are picked first.
    await publication(client, "PUBAAAAB", "Drought: a review");
    await read(client, "PUBAAAAB", "systematic-review");
    await publication(client, "PUBAAAAC", "Farm incomes after floods", "We pooled forty trials.");
    await read(client, "PUBAAAAC", "meta-analysis");
    // Read as a commentary, but an editor says it is a meta-analysis: the editor wins.
    await publication(client, "PUBAAAAD", "Pooling flood studies");
    await read(client, "PUBAAAAD", "commentary");
    await client.query(`UPDATE item SET "studyType" = 'meta-analysis' WHERE key = 'PUBAAAAD'`);
    await publication(client, "PUBAAAAE", "Rice under heat", STUDY);
    const prepared = await prepareDigestForPeriod(db, config, period);
    if (prepared.status !== "queued") throw new Error("The edition was not prepared");
    const [edition] = await db.select().from(notificationEdition).where(eq(notificationEdition.id, prepared.editionId));
    // Counted by type when the list was made, the record not read yet as unread: they add up to the edition's count.
    expect(edition.studyTypes).toEqual({ "meta-analysis": 2, "systematic-review": 1, rct: 1, unread: 1 });
    expect(edition.publicationCount).toBe(5);
    expect(edition.publications.map(entry => [entry.key, entry.studyType ?? null])).toEqual([
      ["PUBAAAAA", "rct"], ["PUBAAAAE", null], ["PUBAAAAB", "systematic-review"], ["PUBAAAAC", "meta-analysis"], ["PUBAAAAD", "meta-analysis"],
    ]);

    const sent: Record<string, unknown>[][] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent.push((JSON.parse(String(init?.body)) as { publications: Record<string, unknown>[] }).publications);
      return Response.json({ digest: written("PUBAAAAA") });
    });
    try {
      await generateNotificationEdition(db, config);
    } finally {
      spy.mockRestore();
    }
    // The writer is told each publication's type, and nothing for one not read yet.
    expect(sent[0]!.map(entry => [entry.key, entry.studyType ?? null])).toEqual([
      ["PUBAAAAA", "rct"], ["PUBAAAAE", null], ["PUBAAAAB", "systematic-review"], ["PUBAAAAC", "meta-analysis"], ["PUBAAAAD", "meta-analysis"],
    ]);
    expect(sent[0]!.every(entry => !("candidate" in entry) && !("kind" in entry))).toBe(true);

    const { getDigestEdition } = await import("@/lib/notifications/public");
    await client.query('UPDATE "notificationEdition" SET "publishedAt" = now()');
    const shown = await getDigestEdition(db, config, "en-GB", prepared.editionId);
    // Meta-analyses before systematic reviews, each type in rank order; the others keep the rank they were listed in.
    expect(shown?.reviews?.keys).toEqual(["PUBAAAAC", "PUBAAAAD", "PUBAAAAB"]);
    expect(shown?.keys).toEqual(["PUBAAAAA", "PUBAAAAE"]);
    expect(shown?.types).toEqual({ listed: { "meta-analysis": 2, "systematic-review": 1, rct: 1, unread: 1 }, period: edition.studyTypes });
  });
}, 120_000);

it("lists an edition's reviews and syntheses apart from its other publications, each with its own pages", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const keys = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}AAAA${"ABCDEFGHJKLMNPQRSTUVWXYZ"[index]}`);
    const reviews = keys("REV", 13);
    const studies = keys("STU", 15);
    for (const key of [...reviews, ...studies]) await publication(client, key, `Publication ${key}`);
    const entry = (key: string, studyType?: string) => ({ key, title: `Publication ${key}`, creators: [], date: "2026-08-10", abstract: null, publicationType: "Report", doi: null, ...(studyType ? { studyType } : {}) });
    const publications = [...reviews.map(key => entry(key, "literature-review")), ...studies.map(key => entry(key, "qualitative"))];
    const [edition] = await db.insert(notificationEdition).values({ stream: "digest", windowStart: period.start, windowEnd: period.end, publications: publications as never, publicationCount: 28, title: "August", summary: "Many.", markdown: "Text.", publishedAt: period.end, nextAttemptAt: null }).returning();
    const { getDigestEdition } = await import("@/lib/notifications/public");

    const first = await getDigestEdition(db, config, "en-GB", edition.id);
    expect(first).toMatchObject({ listed: 28, page: 1, pages: 2, reviews: { listed: 13, page: 1, pages: 2 } });
    expect(first?.reviews?.keys).toEqual(reviews.slice(0, 12));
    expect(first?.keys).toEqual(studies.slice(0, 12));
    // Turning one list's page leaves the other where it was.
    const turned = await getDigestEdition(db, config, "en-GB", edition.id, 1, 2);
    expect(turned?.reviews).toMatchObject({ page: 2, keys: reviews.slice(12) });
    expect(turned?.keys).toEqual(first?.keys);
    // Listed before types were counted: the page has what it lists, and no period counts.
    expect(first?.types).toEqual({ listed: { "literature-review": 13, qualitative: 15 }, period: null });

    // An edition with no review or synthesis is one list.
    await db.update(notificationEdition).set({ publications: studies.map(key => entry(key, "qualitative")) as never }).where(eq(notificationEdition.id, edition.id));
    const plain = await getDigestEdition(db, config, "en-GB", edition.id);
    expect(plain).toMatchObject({ listed: 15, pages: 2 });
    expect(plain).not.toHaveProperty("reviews");
  });
}, 120_000);

it("gives the digests listed before types their records' types, and drops the old likely-review marks", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await publication(client, "PUBAAAAA", "Maize under heat", STUDY);
    await read(client, "PUBAAAAA", "rct");
    await publication(client, "PUBAAAAB", "Drought: a systematic review");
    await read(client, "PUBAAAAB", "commentary");
    await client.query(`UPDATE item SET "studyType" = 'systematic-review' WHERE key = 'PUBAAAAB'`);
    await publication(client, "PUBAAAAC", "Rice under heat", STUDY);
    const entry = (key: string, marks: object) => ({ key, title: `Publication ${key}`, creators: [], date: "2026-08-10", abstract: null, publicationType: "Report", doi: null, ...marks });
    // Stored the old way, with a record that is gone since.
    const stored = [entry("PUBAAAAA", { candidate: false }), entry("PUBAAAAB", { candidate: true, kind: "review" }), entry("PUBAAAAC", { candidate: true }), entry("PUBGONEX", { candidate: false })];
    const [edition] = await db.insert(notificationEdition).values({ stream: "digest", windowStart: period.start, windowEnd: period.end, publications: stored as never, publicationCount: 4, nextAttemptAt: null }).returning();
    const update = readFileSync("drizzle/0089_digest-study-types.sql", "utf8").split("--> statement-breakpoint").filter(statement => /^\s*(--.*\n\s*)*UPDATE/.test(statement));
    expect(update).toHaveLength(1);
    await client.query(update[0]!);
    const [after] = await db.select().from(notificationEdition).where(eq(notificationEdition.id, edition.id));
    // Same publications in the same order, each with its record's type now, an editor's first; none for one unread or gone.
    expect(after.publications).toEqual([
      entry("PUBAAAAA", { studyType: "rct" }), entry("PUBAAAAB", { studyType: "systematic-review" }), entry("PUBAAAAC", {}), entry("PUBGONEX", {}),
    ]);
  });
}, 120_000);
