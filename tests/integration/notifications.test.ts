import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/db/database-schema";
import {readFileSync} from "node:fs";
import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const smtp = vi.hoisted(() => ({sendMail: vi.fn()}));
vi.mock("nodemailer", () => ({default: {createTransport: () => ({sendMail: smtp.sendMail, close() {}})}}));
import { eq } from "drizzle-orm";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { createNativeItemDraft, publishItemDraft, openItemDraft, saveItemDraft } from "@/lib/admin/native-item-service";
import { notificationDelivery, notificationEdition, notificationItem, notificationState, notificationSubscriber } from "@/db/schema/notifications";
import { prepareNotificationEditions, prepareDigestForPeriod, generateNotificationEdition } from "@/lib/notifications/editions";
import { getDigestEdition, getNextDigestEdition, listDigestEditions, listEarlierDigests } from "@/lib/notifications/public";
import { runNotificationCycle } from "@/lib/notifications/worker";
import { deliverNotification } from "@/lib/notifications/delivery";
import { requestSubscription, confirmSubscription, updateSubscription } from "@/lib/notifications/subscriptions";

const config = libraryConfigSchema.parse({...maximalLibraryConfig, sources: [], notifications: {enabled: true, digestCovers: "added", schedule: {frequency: "weekly", weekday: 1, time: "09:00", timezone: "UTC"}}, updatedAt: "2026-09-09T00:00:00Z"});

it.each([
  {schedule: {frequency: "weekly" as const, weekday: 1, time: "09:00", timezone: "UTC"}, scheduledAt: new Date("2026-09-14T09:00:00Z")},
  {schedule: {frequency: "monthly" as const, dayOfMonth: 31, time: "09:00", timezone: "UTC"}, scheduledAt: new Date("2026-09-30T09:00:00Z")},
])("shares manual and $schedule.frequency digest windows without duplicate or empty editions", async ({schedule, scheduledAt}) => {
  const scheduledConfig = {...config, notifications: {...config.notifications, schedule}};
  await withIsolatedPublicationDatabase(async (db, client) => {
    const start = new Date("2026-09-09T00:00:00Z");
    const manualAt = new Date("2026-09-10T12:00:00Z");
    await prepareNotificationEditions(db, config, start);
    const first = await createNativeItemDraft(db, {itemType: "Report", title: "Before the manual cutoff"});
    await publishItemDraft(db, first.itemKey);
    await client.query('UPDATE "notificationItem" SET "firstPublishedAt" = $1 WHERE "itemKey" = $2', ["2026-09-10T10:00:00Z", first.itemKey]);

    const results = await Promise.all([
      prepareNotificationEditions(db, config, manualAt, {manualDigest: true}),
      prepareNotificationEditions(db, config, manualAt, {manualDigest: true}),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(["empty", "queued"]);
    const [manual] = await db.select().from(notificationEdition);
    expect(manual).toMatchObject({stream: "digest", windowStart: start, windowEnd: manualAt, publishedAt: null});
    expect(manual.publications.map(item => item.key)).toEqual([first.itemKey]);
    expect((await db.select().from(notificationState))[0]).toMatchObject({digestThrough: manualAt, hourlyThrough: start, nextDigestAt: new Date("2026-09-14T09:00:00Z")});

    // Changing cadence preserves the previous manual cutoff and unannounced items.
    await prepareNotificationEditions(db, scheduledConfig, new Date("2026-09-11T12:00:00Z"), {manualDigest: true});
    expect((await db.select().from(notificationState))[0].nextDigestAt).toEqual(scheduledAt);
    expect((await db.select().from(notificationState))[0].digestThrough).toEqual(manualAt);
    const second = await createNativeItemDraft(db, {itemType: "Report", title: "After the manual cutoff"});
    await publishItemDraft(db, second.itemKey);
    await client.query('UPDATE "notificationItem" SET "firstPublishedAt" = $1 WHERE "itemKey" = $2', ["2026-09-12T10:00:00Z", second.itemKey]);
    await Promise.all([
      prepareNotificationEditions(db, scheduledConfig, scheduledAt),
      prepareNotificationEditions(db, scheduledConfig, scheduledAt, {manualDigest: true}),
    ]);
    const digest = await db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest"));
    expect(digest).toHaveLength(2);
    const next = digest.find(edition => edition.id !== manual.id)!;
    expect(next).toMatchObject({windowStart: manualAt, windowEnd: scheduledAt});
    expect(next.publications.map(item => item.key)).toEqual([second.itemKey]);
    const disabled = {...config, notifications: {...config.notifications, enabled: false}};
    expect(await prepareNotificationEditions(db, disabled, scheduledAt, {manualDigest: true})).toEqual({status: "disabled"});
    expect(await db.select().from(notificationDelivery)).toHaveLength(0);
  });
}, 120_000);
// These assertions exercise persisted windows, jobs and publication transitions, independent of UI copy.
it("keeps drafts private, batches first publications once and honors queued unsubscribe", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    const email = "reader@example.org";
    await Promise.all([requestSubscription(db, {email, digest: true, instant: true}, new Date("2026-09-09T00:01:00Z")), requestSubscription(db, {email, digest: true, instant: true}, new Date("2026-09-09T00:01:00Z"))]);
    const subscribers = await db.select().from(notificationSubscriber);
    expect(subscribers).toHaveLength(1);
    expect(await db.select().from(notificationDelivery)).toHaveLength(1);
    const subscriber = subscribers[0];
    expect(await confirmSubscription(db, "invalid")).toBe(false);
    expect(await confirmSubscription(db, subscriber.token, new Date("2026-09-09T00:02:00Z"))).toBe(true);
    await requestSubscription(db, {email, digest: false, instant: true}, new Date("2026-09-11T00:00:00Z"));
    expect((await db.select().from(notificationSubscriber))[0].digest).toBe(true);
    const draft = await createNativeItemDraft(db, {itemType: "Report", title: "First addition"});
    expect(await db.select().from(notificationItem)).toHaveLength(0);
    await publishItemDraft(db, draft.itemKey);
    const [first] = await db.select().from(notificationItem);
    expect(first.eligible).toBe(true);
    expect(first.firstPublishedAt).toBeInstanceOf(Date);
    await client.query('UPDATE "notificationItem" SET "firstPublishedAt" = $1', ["2026-09-09T00:15:00Z"]);
    const opened = await openItemDraft(db, draft.itemKey);
    await saveItemDraft(db, {itemKey: draft.itemKey, expectedDraftRevision: opened.draftRevision, expectedPayload: opened.payload, payload: {...opened.payload, title: "Corrected addition"}});
    await publishItemDraft(db, draft.itemKey);
    expect((await db.select().from(notificationItem))[0].firstPublishedAt?.toISOString()).toBe("2026-09-09T00:15:00.000Z");
    await Promise.all([prepareNotificationEditions(db, config, new Date("2026-09-09T01:00:00Z")), prepareNotificationEditions(db, config, new Date("2026-09-09T01:00:00Z"))]);
    const editions = await db.select().from(notificationEdition);
    expect(editions).toHaveLength(1);
    expect(editions[0].publications.map(p => p.title)).toEqual(["Corrected addition"]);
    await Promise.all([generateNotificationEdition(db, config), generateNotificationEdition(db, config)]);
    const deliveries = await db.select().from(notificationDelivery).where(eq(notificationDelivery.editionId, editions[0].id));
    expect(deliveries).toHaveLength(1);
    expect(await updateSubscription(db, subscriber.token, {digest: true, instant: false})).toBe(true);
    expect((await db.select().from(notificationDelivery).where(eq(notificationDelivery.editionId, editions[0].id)))[0].status).toBe("skipped");
    await prepareNotificationEditions(db, config, new Date("2026-09-09T02:00:00Z"));
    expect(await db.select().from(notificationEdition)).toHaveLength(1);
  });
}, 120_000);

it("checks back while OpenScholar writes a digest without spending an attempt, then publishes it", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    await requestSubscription(db, {email: "reader@example.org", digest: true, instant: false});
    const [subscriber] = await db.select().from(notificationSubscriber);
    expect(await confirmSubscription(db, subscriber.token)).toBe(true);
    const draft = await createNativeItemDraft(db, {itemType: "Report", title: "Attention in classrooms"});
    await publishItemDraft(db, draft.itemKey);
    expect(await prepareNotificationEditions(db, config, new Date(), {manualDigest: true})).toMatchObject({status: "queued", publicationCount: 1});
    const digest = {title: "Attention in learning", summary: "A new framework.", markdown: `See [Mills, 2026](/lib/${draft.itemKey})`, model: "openai/gpt-6-luna", reasoning: "max"};
    const openScholar = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({status: "pending"}, {status: 202}))
      .mockResolvedValueOnce(Response.json({digest}));
    try {
      expect(await generateNotificationEdition(db, config)).toBe(true);
      const [pending] = await db.select().from(notificationEdition);
      expect(pending).toMatchObject({publishedAt: null, attempts: 0, lastError: null, leaseToken: null});
      expect(pending.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await generateNotificationEdition(db, config)).toBe(false);
      await client.query('UPDATE "notificationEdition" SET "nextAttemptAt" = now()');
      expect(await generateNotificationEdition(db, config)).toBe(true);
      const [published] = await db.select().from(notificationEdition);
      expect(published).toMatchObject({title: digest.title, model: digest.model, attempts: 0});
      expect(published.publishedAt).toBeInstanceOf(Date);
      expect(await db.select().from(notificationDelivery).where(eq(notificationDelivery.editionId, published.id))).toHaveLength(1);
      const requests = openScholar.mock.calls.map(([url, init]) => ({url: String(url), editionId: JSON.parse(String(init?.body)).editionId}));
      expect(requests).toEqual([0, 1].map(() => ({url: "https://spotted-woodpecker-546.convex.site/api/v1/evidence-libraries/digests/generate", editionId: published.id})));
    } finally {
      openScholar.mockRestore();
    }
  });
}, 120_000);

it("excludes the first Zotero sync but includes subsequent additions, including after an empty initial sync", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await client.query(`INSERT INTO "sourceConnection" ("key", "provider", "scopeKind", "externalScopeKey", "syncCursor") VALUES ('zotero-test', 'zotero', 'group', '123456', '{}')`);
    for (const [key, cursor, eligible] of [
      ["SYNC2222", {}, false],
      ["SYNC2223", {libraryVersion: 0, pending: {offset: 100}}, false],
      ["SYNC2224", {libraryVersion: 0}, true],
      ["SYNC2225", {libraryVersion: 12, pending: {offset: 100}}, true],
    ] as const) {
      await client.query('UPDATE "sourceConnection" SET "syncCursor" = $1 WHERE "key" = $2', [JSON.stringify(cursor), "zotero-test"]);
      await client.query('INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, $2, $1)', [key, "zotero-test"]);
      await client.query('INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title") VALUES ($1, $2, $1, $3, $4)', [key, "zotero-test", "Report", "Synced report"]);
      const [event] = await db.select().from(notificationItem).where(eq(notificationItem.itemKey, key));
      expect(event.eligible).toBe(eligible);
    }
  });
}, 120_000);

it("excludes an import source's first run but includes what it adds later, and backfills those additions", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await client.query(`INSERT INTO "sourceConnection" ("key", "provider", "scopeKind") VALUES ('openalex-test', 'openalex', 'query')`);
    const add = async (key: string) => {
      await client.query('INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, $2, $1)', [key, "openalex-test"]);
      await client.query('INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title") VALUES ($1, $2, $1, $3, $4)', [key, "openalex-test", "JournalArticle", "Imported work"]);
    };
    const eligible = async () => Object.fromEntries((await db.select().from(notificationItem)).map(row => [row.itemKey, row.eligible]));
    await add("FIRST222");
    await client.query(`INSERT INTO "sourceSyncState" ("sourceConnectionKey", "lastSuccessAt") VALUES ('openalex-test', now())`);
    await add("LATER222");
    expect(await eligible()).toMatchObject({FIRST222: false, LATER222: true});

    // The old rule left later additions out; the backfill takes back only those.
    await client.query(`INSERT INTO "sourceSyncRun" ("sourceConnectionKey", "workerId", "status", "startedAt", "finishedAt", "result") VALUES ('openalex-test', 'worker', 'succeeded', '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z', '{}')`);
    await client.query(`UPDATE "notificationItem" SET "eligible" = false, "firstPublishedAt" = CASE "itemKey" WHEN 'FIRST222' THEN timestamptz '2026-09-28T00:30:00Z' ELSE timestamptz '2026-09-29T02:00:00Z' END`);
    const backfill = readFileSync("drizzle/0075_import-source-additions-notify.sql", "utf8").split("--> statement-breakpoint").filter(statement => /^\s*(--.*\n\s*)*UPDATE/.test(statement));
    expect(backfill).toHaveLength(1);
    await client.query(backfill[0]);
    expect(await eligible()).toMatchObject({FIRST222: false, LATER222: true});
  });
}, 120_000);

it("does not resend accepted or ambiguous SMTP deliveries, and skips expired confirmations", async () => {
  await withIsolatedPublicationDatabase(async db => {
    smtp.sendMail.mockReset().mockResolvedValue({accepted: ["reader@example.org"]});
    await requestSubscription(db, {email: "reader@example.org", digest: true, instant: false});
    await Promise.all([runNotificationCycle(db, config), runNotificationCycle(db, config)]);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    expect((await db.select().from(notificationDelivery))[0].status).toBe("sent");
    const message = smtp.sendMail.mock.calls[0][0];
    expect(message.text).toContain("/digests/confirm?token=");
    expect(message.headers["List-Unsubscribe"]).toContain("/digests/unsubscribe?token=");
    await deliverNotification(db, config);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    await requestSubscription(db, {email: "uncertain@example.org", digest: true, instant: false});
    smtp.sendMail.mockRejectedValueOnce(new Error("Connection closed after SMTP DATA"));
    await deliverNotification(db, config);
    await deliverNotification(db, config);
    expect(smtp.sendMail).toHaveBeenCalledTimes(2);
    expect((await db.select().from(notificationDelivery)).map(row => row.status).sort()).toEqual(["sent", "uncertain"]);
    await requestSubscription(db, {email: "expired@example.org", digest: true, instant: false}, new Date("2020-01-01T00:00:00Z"));
    await deliverNotification(db, config);
    expect(smtp.sendMail).toHaveBeenCalledTimes(2);
    expect((await db.select().from(notificationDelivery)).map(row => row.status)).toContain("skipped");
  });
}, 120_000);


it("publishes only saved digest editions, preserving their metadata and hiding unfinished summaries", async () => {
  await withIsolatedPublicationDatabase(async db => {
    const windowStart = new Date("2026-09-01T00:00:00Z");
    const windowEnd = new Date("2026-09-08T00:00:00Z");
    const [published] = await db.insert(notificationEdition).values({stream: "digest", windowStart, windowEnd, publications: [], title: "Saved title", summary: "Saved summary", markdown: "Saved body", publishedAt: windowEnd}).returning();
    await db.insert(notificationEdition).values([
      {stream: "digest", windowStart, windowEnd: new Date("2026-09-15T00:00:00Z"), publications: [], title: "Private title"},
      {stream: "hourly", windowStart, windowEnd, publications: [], title: "Email only", publishedAt: windowEnd},
    ]);
    expect((await listDigestEditions(db, config, "en-GB")).editions.map(edition => edition.slug)).toEqual([published.id]);
    expect(await getDigestEdition(db, config, "en-GB", published.id)).toMatchObject({title: "Saved title", summary: "Saved summary", markdown: "Saved body"});
    expect(await listEarlierDigests(db, config, "en-GB", published.id)).toEqual([]);
    const [unfinished] = await db.select().from(notificationEdition).where(eq(notificationEdition.title, "Private title"));
    expect(await getDigestEdition(db, config, "en-GB", unfinished.id)).toBeUndefined();
    expect(await getDigestEdition(db, config, "en-GB", "not-a-uuid")).toBeUndefined();
    expect(await getNextDigestEdition(db, {...config, notifications: {...config.notifications, enabled: false}}, "en-GB")).toBeNull();
  });
}, 120_000);

it("retries pre-connection SMTP failures and lets confirmed readers recover preferences without resubscribing", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    smtp.sendMail.mockReset().mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), {command: "CONN", code: "ESOCKET"}));
    await requestSubscription(db, {email: "recover@example.org", digest: true, instant: false});
    await deliverNotification(db, config);
    expect((await db.select().from(notificationDelivery))[0]).toMatchObject({status: "queued", attempts: 1, sendStartedAt: null});
    await client.query('UPDATE "notificationDelivery" SET "nextAttemptAt" = now()');
    smtp.sendMail.mockResolvedValue({accepted: ["recover@example.org"]});
    await deliverNotification(db, config);
    expect((await db.select().from(notificationDelivery))[0].status).toBe("sent");
    const [subscriber] = await db.select().from(notificationSubscriber);
    await confirmSubscription(db, subscriber.token);
    await updateSubscription(db, subscriber.token, {digest: false, instant: false});
    await client.query('UPDATE "notificationSubscriber" SET "confirmationRequestedAt" = now() - interval \'2 days\'');
    await requestSubscription(db, {email: subscriber.email, digest: true, instant: true});
    await deliverNotification(db, config);
    expect((await db.select().from(notificationSubscriber))[0]).toMatchObject({digest: false, instant: false, token: subscriber.token});
    expect(smtp.sendMail.mock.lastCall?.[0].text).toContain(`/digests/preferences?token=${subscriber.token}`);
    expect(smtp.sendMail.mock.lastCall?.[0].text).not.toContain("/digests/confirm");
    expect((await db.select().from(notificationDelivery)).filter(row => row.status === "sent")).toHaveLength(2);
  });
}, 120_000);

it("stops retrying a digest after six failed generation attempts", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await db.insert(notificationEdition).values({stream: "digest", windowStart: new Date("2026-09-01"), windowEnd: new Date("2026-09-08"), publications: [], attempts: 5});
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unavailable", {status: 503}));
    try {
      await generateNotificationEdition(db, config);
      expect((await db.select().from(notificationEdition))[0]).toMatchObject({attempts: 6, nextAttemptAt: null, publishedAt: null});
      expect(await generateNotificationEdition(db, config)).toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
    } finally { request.mockRestore(); }
  });
}, 120_000);

it("collects late commits and newly revealed items once without replaying every missed hourly email", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const visibleConfig = {...config, content: {...config.content, tags: {...config.content.tags, hidden: ["hide"]}}};
    await prepareNotificationEditions(db, visibleConfig, new Date("2026-09-09T00:00:00Z"));
    await prepareNotificationEditions(db, visibleConfig, new Date("2026-09-09T01:00:00Z"));
    const draft = await createNativeItemDraft(db, {itemType: "Report", title: "Committed after the hour closed"});
    await publishItemDraft(db, draft.itemKey);
    await client.query('UPDATE "notificationItem" SET "firstPublishedAt" = $1 WHERE "itemKey" = $2', ["2026-09-09T00:59:59Z", draft.itemKey]);
    const hidden = await createNativeItemDraft(db, {itemType: "Report", title: "Initially hidden"});
    await publishItemDraft(db, hidden.itemKey);
    await client.query('UPDATE "notificationItem" SET "firstPublishedAt" = $1 WHERE "itemKey" = $2', ["2026-09-09T00:50:00Z", hidden.itemKey]);
    await client.query('INSERT INTO "tag" ("name") VALUES (\'hide\')');
    await client.query('INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES ($1, \'hide\')', [hidden.itemKey]);
    await prepareNotificationEditions(db, visibleConfig, new Date("2026-09-09T05:00:00Z"));
    const [first] = await db.select().from(notificationEdition);
    expect(first.publications.map(p => p.key)).toEqual([draft.itemKey]);
    expect(first.windowEnd.toISOString()).toBe("2026-09-09T05:00:00.000Z");
    await client.query('DELETE FROM "itemToTag" WHERE "itemKey" = $1', [hidden.itemKey]);
    await prepareNotificationEditions(db, visibleConfig, new Date("2026-09-09T06:00:00Z"));
    await prepareNotificationEditions(db, visibleConfig, new Date("2026-09-09T07:00:00Z"));
    const editions = await db.select().from(notificationEdition);
    expect(editions).toHaveLength(2);
    expect(editions.flatMap(e => e.publications.map(p => p.key)).sort()).toEqual([draft.itemKey, hidden.itemKey].sort());
  });
}, 120_000);

// Execute the real upgrade over populated pre-upgrade columns and stream values.
it("preserves subscriber tokens, published editions and cutoffs when renaming digest storage", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const cutoff = new Date("2026-09-10T12:00:00Z");
    const nextAt = new Date("2026-09-14T09:00:00Z");
    await db.insert(notificationState).values({enabled: true, enabledAt: cutoff, hourlyThrough: cutoff, digestThrough: cutoff, nextDigestAt: nextAt, schedule: JSON.stringify({weekday: 1, time: "09:00", timezone: "UTC"})});
    await requestSubscription(db, {email: "migration@example.org", digest: true, instant: false});
    const [before] = await db.select().from(notificationSubscriber);
    await confirmSubscription(db, before.token);
    const [edition] = await db.insert(notificationEdition).values({stream: "digest", windowStart: new Date("2026-09-01T00:00:00Z"), windowEnd: cutoff, publications: [], title: "Saved edition", publishedAt: cutoff}).returning();
    await client.query(`ALTER TABLE "notificationState" RENAME COLUMN "digestThrough" TO "weeklyThrough";
      ALTER TABLE "notificationState" RENAME COLUMN "nextDigestAt" TO "nextWeeklyAt";
      ALTER TABLE "notificationSubscriber" RENAME COLUMN "digest" TO "weekly";
      UPDATE "notificationEdition" SET "stream" = 'weekly';`);
    await client.query(readFileSync("drizzle/0058_library_digest_schedule.sql", "utf8"));
    expect((await db.select().from(notificationSubscriber))[0]).toMatchObject({id: before.id, token: before.token, digest: true, instant: false, confirmedAt: expect.any(Date)});
    expect((await db.select().from(notificationEdition))[0]).toMatchObject({id: edition.id, stream: "digest", title: "Saved edition", publishedAt: cutoff});
    const [state] = await db.select().from(notificationState);
    expect(state).toMatchObject({digestThrough: cutoff, nextDigestAt: nextAt});
    expect(JSON.parse(state.schedule)).toEqual({frequency: "weekly", weekday: 1, time: "09:00", timezone: "UTC"});
    const draft = await createNativeItemDraft(db, {itemType: "Report", title: "Added before the saved schedule"});
    await publishItemDraft(db, draft.itemKey);
    await client.query('UPDATE "notificationItem" SET "firstPublishedAt" = $1 WHERE "itemKey" = $2', ["2026-09-12T10:00:00Z", draft.itemKey]);
    // The worker must send an overdue edition after upgrade, not postpone it.
    await prepareNotificationEditions(db, config, new Date("2026-09-14T09:05:00Z"));
    const digests = await db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest"));
    expect(digests).toHaveLength(2);
    expect(digests.find(row => row.id !== edition.id)).toMatchObject({windowStart: cutoff, windowEnd: nextAt});
  });
}, 120_000);


it("covers every publication in the window, lists the first thousand and carries none into the next digest", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const start = new Date("2026-09-09T00:00:00Z");
    await prepareNotificationEditions(db, config, start);
    await client.query(`INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") SELECT 'B' || translate(lpad(i::text, 7, '0'), '0123456789', 'ABCDEFGHIJ'), 'native', 'B' || translate(lpad(i::text, 7, '0'), '0123456789', 'ABCDEFGHIJ') FROM generate_series(1, 1001) i`);
    await client.query(`INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, "DOI") SELECT key, 'native', key, 'Report', 'Publication ' || key, '10.5555/' || lower(key) FROM "itemIdentity" WHERE key LIKE 'B%'`);
    await client.query(`UPDATE "notificationItem" SET "firstPublishedAt" = '2026-09-10T00:00:00Z'`);
    let queries = 0;
    const measured = drizzle({ client, schema, logger: { logQuery() { queries++; } } });
    const first = await prepareNotificationEditions(measured, config, new Date("2026-09-10T12:00:00Z"), {manualDigest: true});
    expect(first).toMatchObject({status: "queued", publicationCount: 1001});
    expect(queries).toBeLessThan(20);
    const [edition] = await db.select().from(notificationEdition);
    expect(edition).toMatchObject({publicationCount: 1001});
    expect(edition.publications).toHaveLength(1000);
    expect(edition.publications[0]).toMatchObject({key: "BAAAAAAB", doi: "10.5555/baaaaaab", item: {DOI: "10.5555/baaaaaab"}});
    expect(edition.publications.at(-1)?.key).toBe("BAAABAAA");
    // The publication past the cap is covered, not carried into the next edition.
    const covered = await db.select({key: notificationItem.itemKey}).from(notificationItem).where(eq(notificationItem.digestEditionId, edition.id));
    expect(covered).toHaveLength(1001);
    expect(await prepareNotificationEditions(db, config, new Date("2026-09-10T13:00:00Z"), {manualDigest: true})).toEqual({status: "empty"});
    await client.query(`UPDATE "notificationEdition" SET "publishedAt" = now(), title = 'Large', summary = 'Large', markdown = 'Large' WHERE id = $1`, [edition.id]);
    // A page past the end shows the last page, which lists only this page's keys.
    expect(await getDigestEdition(db, config, "en-GB", edition.id, 999)).toMatchObject({publicationCount: 1001, listed: 1000, page: 84, pages: 84, keys: edition.publications.slice(996).map(p => p.key)});
    // Records deleted after publishing drop out of the pages instead of leaving gaps.
    await client.query(`UPDATE item SET deleted = 1 WHERE key = ANY($1)`, [edition.publications.slice(0, 4).map(p => p.key)]);
    expect(await getDigestEdition(db, config, "en-GB", edition.id, 1)).toMatchObject({listed: 996, pages: 83, keys: edition.publications.slice(4, 16).map(p => p.key)});
  });
}, 120_000);

const publishedConfig = {...config, notifications: {...config.notifications, digestCovers: "published" as const}};
const dated = (client: {query: (text: string, values: unknown[]) => Promise<unknown>}, key: string, date: string, abstract: string | null = null) => client.query(
  `WITH identity AS (INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1))
   INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, date, "abstractNote") VALUES ($1, 'native', $1, 'Report', 'Publication ' || $1, $2, $3)`, [key, date, abstract]);

it("covers what was published in the period whenever it was added, and lists a record with an abstract first", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, publishedConfig, new Date("2026-09-09T00:00:00Z"));
    // Every record is added today, long after these periods, so none counts as an addition in them.
    await dated(client, "PUBAAAAA", "2026-09-09");
    await dated(client, "PUBAAAAB", "2026-09-13", "A study of attention in classrooms. ".repeat(8));
    await dated(client, "PUBAAAAC", "2026-09-14");
    await dated(client, "PUBAAAAD", "2019-05-01", "An older study that only now entered the library. ".repeat(8));
    await dated(client, "PUBAAAAE", "2026");
    expect(await prepareNotificationEditions(db, publishedConfig, new Date("2026-09-14T09:00:00Z"))).toMatchObject({status: "queued", publicationCount: 2});
    const [first] = await db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest"));
    expect(first.publications.map(publication => publication.key)).toEqual(["PUBAAAAB", "PUBAAAAA"]);
    // The day the digest goes out belongs to the next period.
    expect(await prepareNotificationEditions(db, publishedConfig, new Date("2026-09-21T09:00:00Z"))).toMatchObject({status: "queued", publicationCount: 1});
    const editions = await db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest"));
    expect(editions.find(edition => edition.id !== first.id)!.publications.map(publication => publication.key)).toEqual(["PUBAAAAC"]);
  });
}, 120_000);

it("skips scheduled digests while paused, then covers everything since the last one", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const paused = {...publishedConfig, notifications: {...publishedConfig.notifications, pausedSince: "2026-09-13T08:00:00.000Z"}};
    const digests = () => db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest"));
    const enabledAt = new Date("2026-09-09T00:00:00Z");
    await prepareNotificationEditions(db, publishedConfig, enabledAt);
    await dated(client, "PAUSAAAA", "2026-09-10");
    await dated(client, "PAUSAAAB", "2026-09-16");
    await dated(client, "PAUSAAAC", "2026-09-24");
    for (const monday of ["2026-09-14T09:00:00Z", "2026-09-21T09:00:00Z"]) {
      expect(await prepareNotificationEditions(db, paused, new Date(monday))).toEqual({status: "empty"});
    }
    expect(await digests()).toHaveLength(0);
    // The place is kept and the schedule moves on, so no date is promised and nothing is owed for the skipped weeks.
    expect((await db.select().from(notificationState))[0]).toMatchObject({digestThrough: enabledAt, nextDigestAt: new Date("2026-09-28T09:00:00Z")});
    expect(await getNextDigestEdition(db, paused, "en-GB")).toBeNull();

    // Resuming mid-week sends nothing until the next scheduled time.
    expect(await prepareNotificationEditions(db, publishedConfig, new Date("2026-09-22T12:00:00Z"))).toEqual({status: "empty"});
    expect(await digests()).toHaveLength(0);
    expect(await prepareNotificationEditions(db, publishedConfig, new Date("2026-09-28T09:00:00Z"))).toMatchObject({status: "queued", publicationCount: 3});
    const [edition] = await digests();
    expect(edition).toMatchObject({windowStart: enabledAt, windowEnd: new Date("2026-09-28T09:00:00Z")});
    expect(edition.publications.map(publication => publication.key).sort()).toEqual(["PAUSAAAA", "PAUSAAAB", "PAUSAAAC"]);
  });
}, 120_000);

it("reaches a month back after a long pause, and never carries older additions into a later digest", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    const paused = {...config, notifications: {...config.notifications, pausedSince: "2026-09-13T08:00:00.000Z"}};
    const digests = () => db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest")).orderBy(notificationEdition.windowEnd);
    const added = async (title: string, at: string) => {
      const draft = await createNativeItemDraft(db, {itemType: "Report", title});
      await publishItemDraft(db, draft.itemKey);
      await client.query('UPDATE "notificationItem" SET "firstPublishedAt" = $1 WHERE "itemKey" = $2', [at, draft.itemKey]);
      return draft.itemKey;
    };
    await prepareNotificationEditions(db, config, new Date("2026-06-01T00:00:00Z"));
    const old = await added("Added early in the pause", "2026-06-10T10:00:00Z");
    const recent = await added("Added in the last month", "2026-09-20T10:00:00Z");
    expect(await prepareNotificationEditions(db, paused, new Date("2026-09-21T09:00:00Z"))).toEqual({status: "empty"});
    expect(await digests()).toHaveLength(0);

    expect(await prepareNotificationEditions(db, config, new Date("2026-09-28T09:00:00Z"))).toMatchObject({status: "queued", publicationCount: 1});
    const [first] = await digests();
    expect(first).toMatchObject({windowStart: new Date("2026-08-27T09:00:00Z"), windowEnd: new Date("2026-09-28T09:00:00Z")});
    expect(first.publications.map(publication => publication.key)).toEqual([recent]);
    // The older addition is settled with this digest, so the next one does not pick it up.
    const [settled] = await db.select().from(notificationItem).where(eq(notificationItem.itemKey, old));
    expect(settled.digestEditionId).toBe(first.id);
    const next = await added("Added the week after", "2026-09-30T10:00:00Z");
    expect(await prepareNotificationEditions(db, config, new Date("2026-10-05T09:00:00Z"))).toMatchObject({status: "queued", publicationCount: 1});
    expect((await digests())[1].publications.map(publication => publication.key)).toEqual([next]);
  });
}, 120_000);

it("counts a preprint and its article as one publication and lists the article", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, publishedConfig, new Date("2026-09-09T00:00:00Z"));
    const version = (key: string, itemType: string, title: string, creators: object[]) => client.query(
      `WITH identity AS (INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1))
       INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, date, "abstractNote", creators) VALUES ($1, 'native', $1, $2, $3, '2026-09-10', $4, $5::jsonb)`,
      [key, itemType, title, "A study of attention in classrooms. ".repeat(8), JSON.stringify(creators)]);
    const mills = [{creatorType: "author", firstName: "Caitlin", lastName: "Mills"}];
    await version("PUBAAAAA", "Preprint", "Attention in classrooms: a field experiment", mills);
    // The article's title ends in a full stop and lists its editor before its author.
    await version("PUBAAAAB", "JournalArticle", "Attention in Classrooms - A Field Experiment.", [{creatorType: "editor", firstName: "Ada", lastName: "Reyes"}, ...mills]);
    // A third copy from a source that stores the author as one name.
    await version("PUBAAAAD", "Preprint", "Attention in classrooms: a field experiment", [{creatorType: "author", name: "Caitlin Mills"}]);
    // The same title by another first author, or by no named author, is another publication.
    await version("PUBAAAAC", "JournalArticle", "Attention in classrooms: a field experiment", [{creatorType: "author", firstName: "Joy", lastName: "Okafor"}]);
    await version("PUBAAAAE", "Report", "Annual report of the ministry of education", []);
    await version("PUBAAAAF", "Report", "Annual report of the ministry of education", []);
    expect(await prepareNotificationEditions(db, publishedConfig, new Date("2026-09-14T09:00:00Z"))).toMatchObject({status: "queued", publicationCount: 4});
    const [edition] = await db.select().from(notificationEdition).where(eq(notificationEdition.stream, "digest"));
    expect(edition.publications.map(publication => publication.key).sort()).toEqual(["PUBAAAAB", "PUBAAAAC", "PUBAAAAE", "PUBAAAAF"]);
  });
}, 120_000);

it("writes a past period's digest by publication date, rewrites it in the same record and emails no one", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, publishedConfig, new Date("2026-09-09T00:00:00Z"));
    await requestSubscription(db, {email: "reader@example.org", digest: true, instant: false});
    const [subscriber] = await db.select().from(notificationSubscriber);
    expect(await confirmSubscription(db, subscriber.token, new Date("2026-07-01T00:00:00Z"))).toBe(true);
    const [schedule] = await db.select().from(notificationState);
    const period = {start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z")};
    await dated(client, "PUBAAAAA", "2026-08-03");
    await dated(client, "PUBAAAAB", "2026-09-01");
    const first = await prepareDigestForPeriod(db, publishedConfig, period);
    expect(first).toMatchObject({status: "queued", publicationCount: 1});
    // An email still waiting from an earlier send of this edition must not go out with the rewrite.
    await client.query(`UPDATE "notificationDelivery" SET status = 'queued', "nextAttemptAt" = now() WHERE "editionId" = $1`, [first.status === "queued" ? first.editionId : null]);
    const digest = {title: "August", summary: "One study.", markdown: "See [Mills, 2026](/lib/PUBAAAAA)", model: "openai/gpt-6-luna", reasoning: "max"};
    const openScholar = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({digest}));
    try {
      expect(await generateNotificationEdition(db, publishedConfig)).toBe(true);
      await dated(client, "PUBAAAAC", "2026-08-20");
      expect(await prepareDigestForPeriod(db, publishedConfig, period)).toEqual({...first, publicationCount: 2});
      const [rewriting] = await db.select().from(notificationEdition);
      expect(rewriting).toMatchObject({windowStart: period.start, windowEnd: period.end, publicationCount: 2, publishedAt: null});
      expect(await generateNotificationEdition(db, publishedConfig)).toBe(true);
    } finally {
      openScholar.mockRestore();
    }
    const editions = await db.select().from(notificationEdition);
    expect(editions).toHaveLength(1);
    expect(editions[0].publishedAt).toBeInstanceOf(Date);
    // The reader confirmed before the period ended, so a scheduled edition would have queued an email.
    expect((await db.select().from(notificationDelivery).where(eq(notificationDelivery.editionId, editions[0].id))).map(delivery => delivery.status)).toEqual(["skipped"]);
    expect((await db.select().from(notificationState))[0]).toEqual(schedule);
    // A period that ends when the next scheduled digest is due: the schedule moves past it and keeps the digest.
    const due = schedule.nextDigestAt!;
    await dated(client, "PUBAAAAD", "2026-09-10");
    const manual = await prepareDigestForPeriod(db, publishedConfig, {start: new Date("2026-09-09T00:00:00Z"), end: due});
    expect(await prepareNotificationEditions(db, publishedConfig, due)).toEqual({status: "empty"});
    expect((await db.select().from(notificationState))[0].digestThrough).toEqual(due);
    expect((await db.select().from(notificationEdition).where(eq(notificationEdition.windowEnd, due))).map(edition => edition.id)).toEqual([manual.status === "queued" ? manual.editionId : null]);
    expect((await listDigestEditions(db, publishedConfig, "en-GB")).editions[0]).toMatchObject({slug: editions[0].id, published: {date: "1 September 2026"}});
  });
}, 120_000);

// Execute the real backfill over editions saved before counts, covers and coverage existed.
it("backfills counts, covers and coverage from saved editions", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await client.query(`INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ('CAAAAAAA', 'native', 'CAAAAAAA'), ('CAAAAAAB', 'native', 'CAAAAAAB')`);
    await client.query(`INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title) VALUES ('CAAAAAAA', 'native', 'CAAAAAAA', 'Report', 'First'), ('CAAAAAAB', 'native', 'CAAAAAAB', 'Report', 'Second')`);
    const saved = (key: string, cover: string | null) => ({key, title: key, creators: [], date: null, abstract: null, publicationType: "Report", doi: null, item: {key, PDFCoverPageImage: cover}});
    const [edition] = await db.insert(notificationEdition).values({stream: "digest", windowStart: new Date("2026-09-01T00:00:00Z"), windowEnd: new Date("2026-09-08T00:00:00Z"), publications: [saved("CAAAAAAA", null), saved("CAAAAAAB", "https://covers.example/second.png")] as never}).returning();
    const backfill = readFileSync("drizzle/0064_digest-edition-coverage.sql", "utf8").split("--> statement-breakpoint").filter(statement => statement.trim().startsWith("UPDATE"));
    for (const statement of backfill) await client.query(statement);
    expect((await db.select().from(notificationEdition))[0]).toMatchObject({publicationCount: 2, cover: "https://covers.example/second.png"});
    const items = await db.select({key: notificationItem.itemKey, digest: notificationItem.digestEditionId, hourly: notificationItem.hourlyEditionId}).from(notificationItem);
    expect(items.filter(row => row.key.startsWith("C"))).toEqual(expect.arrayContaining([{key: "CAAAAAAA", digest: edition.id, hourly: null}, {key: "CAAAAAAB", digest: edition.id, hourly: null}]));
  });
}, 120_000);
