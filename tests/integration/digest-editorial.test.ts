import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { libraryConfigSchema } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { notificationDelivery, notificationEdition, notificationEditionEvent, notificationSubscriber } from "@/db/schema/notifications";
import { generateNotificationEdition, prepareDigestForPeriod, prepareNotificationEditions } from "@/lib/notifications/editions";
import { readAdminDigest, getDigestPapers, listAdminDigests, listDigestPapers, moveDigest, saveDigestDraft, type DigestActor } from "@/lib/notifications/editorial";
import { getDigestEdition } from "@/lib/notifications/public";
import { confirmSubscription, requestSubscription } from "@/lib/notifications/subscriptions";
import { ItemMutationConflictError } from "@/lib/admin/native-item-service";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [], notifications: { enabled: true, digestCovers: "published", schedule: { frequency: "weekly", weekday: 1, time: "09:00", timezone: "UTC" } }, updatedAt: "2026-09-09T00:00:00Z" });
const period = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };
type Client = { query: (text: string, values?: unknown[]) => Promise<unknown> };

const creator: DigestActor = { id: "user_creator", name: "Eunice Jengo", photo: null, role: "creator" };
const other: DigestActor = { id: "user_other", name: "Sam Okoro", photo: null, role: "creator" };
const editor: DigestActor = { id: "user_editor", name: "Gugulethu Dube", photo: "https://img.example/gugu.png", role: "editor" };

const publication = (client: Client, key: string, date: string, title = `Publication ${key}`) => client.query(
  `WITH identity AS (INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1))
   INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, date, creators) VALUES ($1, 'native', $1, 'Report', $3, $2, '[{"name": "Ada Mills", "creatorType": "author"}]')`, [key, date, title]);

const written = { title: "August", summary: "One study.", markdown: "## Reading\n\nSee [Mills, 2026](/lib/PUBAAAAA)." };

/** An edition AI wrote and published, as every digest is while nobody has to approve it. */
async function publishedEdition(db: Database, client: Client) {
  await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
  await publication(client, "PUBAAAAA", "2026-08-03");
  await publication(client, "PUBAAAAB", "2026-08-10");
  const prepared = await prepareDigestForPeriod(db, config, period);
  if (prepared.status !== "queued") throw new Error("The edition was not prepared");
  const openScholar = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ digest: { ...written, model: "openai/gpt-6-luna", reasoning: "max" } }));
  try { await generateNotificationEdition(db, config); } finally { openScholar.mockRestore(); }
  return prepared.editionId;
}

const edited = { title: "August in classrooms", summary: "One study, read closely.", markdown: "## Reading\n\n**Kenya.** A study of reading [Mills, 2026](/lib/PUBAAAAA) and a second [Mills, 2026](/lib/PUBAAAAB).", note: "Start with the Kenya study." };

it("keeps a person's changes private until an Editor publishes them, signed and with their note", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const id = await publishedEdition(db, client);
    const start = await readAdminDigest(db, config, id);
    expect(start).toMatchObject({ state: "published", revision: 0, words: { ...written, note: "" }, ai: written, checkedBy: null });
    expect(start.events.map(event => event.kind)).toEqual(["written"]);

    const draft = await saveDigestDraft(db, config, { id, expectedRevision: 0, words: edited }, creator);
    expect(draft).toMatchObject({ state: "draft", revision: 1, words: edited, published: { ...written, note: "" }, ai: written });
    // Readers still have what was published.
    expect(await getDigestEdition(db, config, "en-GB", id)).toMatchObject(written);
    // A save made from an older revision is refused, so nobody overwrites text they have not seen.
    await expect(saveDigestDraft(db, config, { id, expectedRevision: 0, words: { ...edited, title: "Stale" } }, other)).rejects.toThrow(ItemMutationConflictError);
    // One person's run of saves is one step in the history.
    const again = await saveDigestDraft(db, config, { id, expectedRevision: 1, words: { ...edited, summary: "One study, read twice." } }, creator);
    expect(again.events.map(event => [event.kind, event.actor?.name ?? null])).toEqual([["written", null], ["edited", "Eunice Jengo"]]);

    // A Creator sends it for review and can take it back; only the one who sent it, or an Editor.
    await expect(moveDigest(db, config, { id, expectedRevision: 2, action: "publish" }, creator)).rejects.toThrow("Only an Editor or Owner can publish");
    const review = await moveDigest(db, config, { id, expectedRevision: 2, action: "submit" }, creator);
    expect(review).toMatchObject({ state: "review", revision: 3 });
    expect((await listAdminDigests(db, config)).counts.review).toBe(1);
    await expect(moveDigest(db, config, { id, expectedRevision: 3, action: "submit" }, creator)).rejects.toThrow("already waiting");
    await expect(moveDigest(db, config, { id, expectedRevision: 3, action: "return" }, creator)).rejects.toThrow("Only an Editor or Owner can send a digest back");
    await expect(moveDigest(db, config, { id, expectedRevision: 3, action: "withdraw" }, other)).rejects.toThrow("only take back a digest you sent");
    expect(await moveDigest(db, config, { id, expectedRevision: 3, action: "withdraw" }, creator)).toMatchObject({ state: "draft", revision: 4 });
    await moveDigest(db, config, { id, expectedRevision: 4, action: "submit" }, creator);
    expect(await moveDigest(db, config, { id, expectedRevision: 5, action: "return" }, editor)).toMatchObject({ state: "draft", revision: 6 });
    await moveDigest(db, config, { id, expectedRevision: 6, action: "submit" }, creator);

    const published = await moveDigest(db, config, { id, expectedRevision: 7, action: "publish" }, editor);
    const words = { ...edited, summary: "One study, read twice." };
    expect(published).toMatchObject({ state: "published", revision: 8, words, published: words, checkedBy: { id: "user_editor", name: "Gugulethu Dube", photo: "https://img.example/gugu.png" } });
    expect(published.events.map(event => event.kind)).toEqual(["written", "edited", "submitted", "withdrawn", "submitted", "returned", "submitted", "published"]);
    expect(await getDigestEdition(db, config, "en-GB", id)).toMatchObject({ title: edited.title, markdown: edited.markdown });
    const [row] = await db.select().from(notificationEdition).where(eq(notificationEdition.id, id));
    expect(row).toMatchObject({ note: edited.note, draft: null, reviewRequestedAt: null, ai: written });
    expect((await listAdminDigests(db, config)).counts.review).toBe(0);
    // Text that matches what readers have leaves no draft behind.
    expect(await saveDigestDraft(db, config, { id, expectedRevision: 8, words }, creator)).toMatchObject({ state: "published", revision: 9 });
    await expect(moveDigest(db, config, { id, expectedRevision: 9, action: "submit" }, creator)).rejects.toThrow("no changes to publish");
  });
}, 120_000);

it("emails an edition the first time it is published and never for a later change", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    await publication(client, "PUBAAAAA", "2026-08-03");
    // One reader was subscribed when the period ended, the other joined while the edition waited for an editor.
    for (const [email, confirmed] of [["reader@example.org", "2026-07-01T00:00:00Z"], ["later@example.org", "2026-09-05T00:00:00Z"]] as const) {
      await requestSubscription(db, { email, digest: true, instant: false });
      const [subscriber] = await db.select().from(notificationSubscriber).where(eq(notificationSubscriber.email, email));
      await confirmSubscription(db, subscriber.token, new Date(confirmed));
    }
    // An edition AI has written that waits for an editor.
    const [edition] = await db.insert(notificationEdition).values({ stream: "digest", windowStart: period.start, windowEnd: period.end, publications: [{ key: "PUBAAAAA" }] as never, ai: written, draft: written, nextAttemptAt: null }).returning();
    expect(await getDigestEdition(db, config, "en-GB", edition.id)).toBeUndefined();
    const deliveries = () => db.select().from(notificationDelivery).where(eq(notificationDelivery.editionId, edition.id));

    const first = await moveDigest(db, config, { id: edition.id, expectedRevision: 0, action: "publish" }, editor);
    expect(first).toMatchObject({ state: "published", checkedBy: { name: "Gugulethu Dube" } });
    expect(first.publishedAt).not.toBeNull();
    expect(await getDigestEdition(db, config, "en-GB", edition.id)).toMatchObject(written);
    // Everyone subscribed when it is published gets it.
    expect((await deliveries()).map(delivery => delivery.status)).toEqual(["queued", "queued"]);

    await saveDigestDraft(db, config, { id: edition.id, expectedRevision: 1, words: { ...written, title: "August, corrected", note: "" } }, editor);
    const second = await moveDigest(db, config, { id: edition.id, expectedRevision: 2, action: "publish" }, editor);
    expect(second.publishedAt).toBe(first.publishedAt);
    expect(await deliveries()).toHaveLength(2);
  });
}, 120_000);

it("refuses text a digest cannot hold, with the reason", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const id = await publishedEdition(db, client);
    const save = (markdown: string, more: object = {}) => saveDigestDraft(db, config, { id, expectedRevision: 0, words: { ...edited, markdown, ...more } }, creator);
    await expect(save("See [the paper](https://example.org/paper).")).rejects.toThrow("must point to a publication in this library");
    await expect(save("![chart](/chart.png)")).rejects.toThrow("cannot hold images");
    await expect(save("<script>alert(1)</script>")).rejects.toThrow("Remove the HTML");
    await expect(save("### Too deep\n\nText.")).rejects.toThrow("one level of heading");
    await expect(save("- a list")).rejects.toThrow("headings, paragraphs, bold and citations only");
    // A citation has to lead somewhere readers can go.
    await client.query(`UPDATE item SET "deleted" = 1 WHERE key = 'PUBAAAAB'`);
    await expect(save("See [Mills, 2026](/lib/PUBAAAAB).")).rejects.toThrow("readers cannot open: PUBAAAAB");
    // And it has to be one of this edition's publications, which is all the Cite list offers.
    await publication(client, "PUBAAAAC", "2026-07-03");
    await expect(save("See [Mills, 2026](/lib/PUBAAAAC).")).rejects.toThrow("not in this digest: PUBAAAAC");
    // A card or highlight directive is something the reader's page draws for AI answers; the email would show it raw.
    await expect(save("[RESOURCE /lib/PUBAAAAA RESOURCE/]")).rejects.toThrow("Cite a publication with the Cite button");
    await expect(save(edited.markdown, { title: "Two\nlines" })).rejects.toThrow("Keep the title on one line");
    await expect(save(edited.markdown, { title: "  " })).rejects.toThrow();
    expect((await readAdminDigest(db, config, id)).state).toBe("published");
  });
}, 120_000);

it("does not rewrite a digest under a person's unpublished changes, and replaces a draft only AI has touched", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const id = await publishedEdition(db, client);
    const rewrite = { title: "August, rewritten", summary: "Two studies.", markdown: "## Reading\n\nSee [Mills, 2026](/lib/PUBAAAAB)." };
    const openScholar = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ digest: { ...rewrite, model: "openai/gpt-6-luna", reasoning: "max" } }));
    try {
      await prepareDigestForPeriod(db, config, period);
      // While AI writes, nobody can change the text it is about to replace.
      await expect(saveDigestDraft(db, config, { id, expectedRevision: 0, words: edited }, creator)).rejects.toThrow("AI is writing this digest");
      await generateNotificationEdition(db, config);
      const drafted = await readAdminDigest(db, config, id);
      expect(drafted).toMatchObject({ state: "draft", revision: 1, words: { ...rewrite, note: "" }, published: { ...written, note: "" }, ai: rewrite });
      expect(drafted.events.map(event => event.kind)).toEqual(["written", "written"]);
      // AI's own draft can be rewritten again.
      await prepareDigestForPeriod(db, config, period);
      await generateNotificationEdition(db, config);
      await saveDigestDraft(db, config, { id, expectedRevision: 2, words: edited }, creator);
      await expect(prepareDigestForPeriod(db, config, period)).rejects.toThrow("changes that are not published");
      expect((await readAdminDigest(db, config, id)).words).toEqual(edited);
      // Going back to AI's words after publishing their own is a person's change too.
      await moveDigest(db, config, { id, expectedRevision: 3, action: "publish" }, editor);
      const back = await saveDigestDraft(db, config, { id, expectedRevision: 4, words: { ...rewrite, note: edited.note } }, creator);
      expect(back).toMatchObject({ state: "draft", ai: rewrite });
      await expect(prepareDigestForPeriod(db, config, period)).rejects.toThrow("changes that are not published");
    } finally {
      openScholar.mockRestore();
    }
  });
}, 120_000);

it("offers the edition's publications a page at a time, searched, narrowed and sorted, and only those readers can open", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const entries = [
      { key: "PAPAAAAA", title: "Maize under heat", creators: ["Ada Mills"], date: "2026-08-03", kind: "study" },
      { key: "PAPAAAAB", title: "Drought: a systematic review", creators: ["Ben Okoro", "Cy Adu"], date: "2026-08-20", kind: "review" },
      { key: "PAPAAAAC", title: "Adaptation pooled", creators: ["Dee Zhang", "Eli Abebe", "Fay Noor"], date: "2026-08-11", kind: "meta-analysis" },
      // Saved by an older release, with a creator that is not a name.
      { key: "PAPAAAAD", title: "Flood maps", creators: [null], date: null },
      { key: "PAPAAAAE", title: "Heat in cities", creators: ["Gil Baker"], date: "2026-08-30", kind: "study" },
      { key: "PAPAAAAF", title: "Hidden since", creators: ["Hal Cole"], date: "2026-08-12", kind: "study" },
      { key: "PAPAAAAG", title: "Water storage", creators: ["Ivy Diaz"], date: "2026-08-05", kind: "study" },
    ];
    for (const entry of entries) await publication(client, entry.key, entry.date ?? "2026", entry.title);
    await client.query(`UPDATE item SET deleted = 1 WHERE key = 'PAPAAAAF'`);
    const [edition] = await db.insert(notificationEdition).values({ stream: "digest", windowStart: period.start, windowEnd: period.end, publications: entries as never, ai: written, draft: written, nextAttemptAt: null }).returning();
    const list = (query: Partial<Parameters<typeof listDigestPapers>[3]> = {}) => listDigestPapers(db, config, edition.id, { query: "", show: "all", sort: "newest", page: 1, cited: [], ...query });

    const first = await list({ cited: ["PAPAAAAA", "PAPAAAAE"] });
    expect(first).toMatchObject({ page: 1, pages: 2, total: 6, counts: { all: 6, reviews: 2, uncited: 4 } });
    expect(first.papers.map(paper => [paper.key, paper.label, paper.review])).toEqual([
      ["PAPAAAAE", "Baker, 2026", false], ["PAPAAAAB", "Okoro and Adu, 2026", true], ["PAPAAAAC", "Zhang et al., 2026", true], ["PAPAAAAG", "Diaz, 2026", false], ["PAPAAAAA", "Mills, 2026", false],
    ]);
    expect((await list({ page: 2 })).papers.map(paper => [paper.key, paper.label])).toEqual([["PAPAAAAD", "Unknown"]]);
    // A page past the end is the last page.
    expect((await list({ page: 9 })).page).toBe(2);
    expect((await list({ show: "reviews", sort: "title" })).papers.map(paper => paper.key)).toEqual(["PAPAAAAC", "PAPAAAAB"]);
    expect((await list({ show: "uncited", cited: ["PAPAAAAA", "PAPAAAAE"], sort: "author" })).papers.map(paper => paper.key)).toEqual(["PAPAAAAD", "PAPAAAAG", "PAPAAAAB", "PAPAAAAC"]);
    // Search reads titles and authors, and counts follow it.
    expect(await list({ query: "okoro REVIEW" })).toMatchObject({ total: 1, counts: { all: 1, reviews: 1, uncited: 1 } });
    expect((await list({ query: "100%" })).total).toBe(0);
    // The publications a text cites are named from the edition, hidden or not, and a key it never held is passed over.
    expect((await getDigestPapers(db, config, edition.id, ["PAPAAAAC", "PAPAAAAF", "ZZZZZZZZ"])).papers.map(paper => [paper.key, paper.label]).sort()).toEqual([["PAPAAAAC", "Zhang et al., 2026"], ["PAPAAAAF", "Cole, 2026"]]);
  });
}, 120_000);

it("lists every edition a page at a time with where each stands", async () => {
  await withIsolatedPublicationDatabase(async db => {
    const week = (index: number) => new Date(Date.UTC(2026, 0, 5 + 7 * index, 9));
    const base = (index: number) => ({ stream: "digest" as const, windowStart: week(index - 1), windowEnd: week(index), publications: [], publicationCount: index });
    await db.insert(notificationEdition).values([
      ...Array.from({ length: 19 }, (_, index) => ({ ...base(index), ...written, ai: written, publishedAt: week(index), nextAttemptAt: null })),
      { ...base(19), ...written, ai: written, publishedAt: week(19), nextAttemptAt: null, draft: { ...written, title: "Changed" }, reviewRequestedAt: week(19), checkedBy: { id: "user_editor", name: "Gugulethu Dube", photo: null } },
      { ...base(20), ai: written, draft: written, nextAttemptAt: null },
      { ...base(21), nextAttemptAt: null, lastError: "OpenScholar digest generation returned 500" },
      { ...base(22) },
    ]);
    // An addition email is not a digest.
    await db.insert(notificationEdition).values({ stream: "hourly", windowStart: week(30), windowEnd: week(31), publications: [], title: "New publications", publishedAt: week(31), nextAttemptAt: null });
    const list = (query: Partial<Parameters<typeof listAdminDigests>[2]> = {}) => listAdminDigests(db, config, { page: 1, show: "all", sort: "newest", ...query });
    const first = await list();
    expect(first).toMatchObject({ page: 1, pages: 2, total: 23, counts: { all: 23, draft: 1, review: 1, published: 19 } });
    expect(first.editions).toHaveLength(20);
    expect(first.editions.slice(0, 4).map(row => [row.state, row.title, row.publicationCount, row.checkedBy?.name ?? null])).toEqual([
      ["writing", null, 22, null], ["failed", null, 21, null], ["draft", "August", 20, null], ["review", "Changed", 19, "Gugulethu Dube"],
    ]);
    // An edition is dated by the end of its period, in the library's days.
    expect(first.editions[2]).toMatchObject({ day: "25", month: "May", period: "18 to 25 May" });
    expect((await list({ page: 2 })).editions.map(row => row.state)).toEqual(["published", "published", "published"]);
    expect((await list({ page: 7 })).page).toBe(2);
    expect(await list({ show: "review" })).toMatchObject({ total: 1, pages: 1, editions: [{ title: "Changed" }] });
    expect((await list({ show: "published", sort: "oldest" })).editions[0]).toMatchObject({ day: "5", month: "Jan", period: "29 December to 5 January", state: "published" });
  });
}, 120_000);

// Execute the real backfill over editions published before an edition had a history.
it("gives every digest published before histories its first step: AI wrote it when it was published", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const at = new Date("2026-09-01T00:05:00Z");
    const [published, older] = await db.insert(notificationEdition).values([
      { stream: "digest", windowStart: period.start, windowEnd: period.end, publications: [], ...written, ai: written, publishedAt: at, nextAttemptAt: null },
      // One the older runtime published during an update kept no copy of AI's text.
      { stream: "digest", windowStart: new Date("2026-07-01T00:00:00Z"), windowEnd: period.start, publications: [], ...written, publishedAt: at, nextAttemptAt: null },
      { stream: "digest", windowStart: period.end, windowEnd: new Date("2026-10-01T00:00:00Z"), publications: [] },
    ]).returning();
    const backfill = readFileSync("drizzle/0078_digest-editorial.sql", "utf8").split("--> statement-breakpoint").filter(statement => /^\s*(--.*\n\s*)*INSERT/.test(statement));
    expect(backfill).toHaveLength(1);
    for (const statement of backfill) await client.query(statement);
    const events = await db.select().from(notificationEditionEvent);
    expect(events).toHaveLength(2);
    for (const edition of [published, older]) expect(events).toContainEqual(expect.objectContaining({ editionId: edition.id, kind: "written", at, actor: null }));
  });
}, 120_000);
