import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const smtp = vi.hoisted(() => ({sendMail: vi.fn()}));
vi.mock("nodemailer", () => ({default: {createTransport: () => ({sendMail: smtp.sendMail, close() {}})}}));
import { eq } from "drizzle-orm";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { createNativeItemDraft, publishItemDraft, openItemDraft, saveItemDraft } from "@/lib/admin/native-item-service";
import { notificationDelivery, notificationEdition, notificationItem, notificationSubscriber } from "@/db/schema/notifications";
import { prepareNotificationEditions, generateNotificationEdition } from "@/lib/notifications/editions";
import { getDigestPageData } from "@/lib/notifications/public";
import { runNotificationCycle } from "@/lib/notifications/worker";
import { deliverNotification } from "@/lib/notifications/delivery";
import { requestSubscription, confirmSubscription, updateSubscription } from "@/lib/notifications/subscriptions";

const config = libraryConfigSchema.parse({...maximalLibraryConfig, sources: [], notifications: {enabled: true, weekly: {weekday: 1, time: "09:00", timezone: "UTC"}}, updatedAt: "2026-09-09T00:00:00Z"});
// These assertions exercise persisted windows, jobs and publication transitions, independent of UI copy.
it("keeps drafts private, batches first publications once and honors queued unsubscribe", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    await prepareNotificationEditions(db, config, new Date("2026-09-09T00:00:00Z"));
    const email = "reader@example.org";
    await Promise.all([requestSubscription(db, {email, weekly: true, instant: true}, new Date("2026-09-09T00:01:00Z")), requestSubscription(db, {email, weekly: true, instant: true}, new Date("2026-09-09T00:01:00Z"))]);
    const subscribers = await db.select().from(notificationSubscriber);
    expect(subscribers).toHaveLength(1);
    expect(await db.select().from(notificationDelivery)).toHaveLength(1);
    const subscriber = subscribers[0];
    expect(await confirmSubscription(db, "invalid")).toBe(false);
    expect(await confirmSubscription(db, subscriber.token, new Date("2026-09-09T00:02:00Z"))).toBe(true);
    await requestSubscription(db, {email, weekly: false, instant: true}, new Date("2026-09-11T00:00:00Z"));
    expect((await db.select().from(notificationSubscriber))[0].weekly).toBe(true);
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
    expect(await updateSubscription(db, subscriber.token, {weekly: true, instant: false})).toBe(true);
    expect((await db.select().from(notificationDelivery).where(eq(notificationDelivery.editionId, editions[0].id)))[0].status).toBe("skipped");
    await prepareNotificationEditions(db, config, new Date("2026-09-09T02:00:00Z"));
    expect(await db.select().from(notificationEdition)).toHaveLength(1);
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

it("does not resend accepted or ambiguous SMTP deliveries, and skips expired confirmations", async () => {
  await withIsolatedPublicationDatabase(async db => {
    smtp.sendMail.mockReset().mockResolvedValue({accepted: ["reader@example.org"]});
    await requestSubscription(db, {email: "reader@example.org", weekly: true, instant: false});
    await Promise.all([runNotificationCycle(db, config), runNotificationCycle(db, config)]);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    expect((await db.select().from(notificationDelivery))[0].status).toBe("sent");
    const message = smtp.sendMail.mock.calls[0][0];
    expect(message.text).toContain("/digests/confirm?token=");
    expect(message.headers["List-Unsubscribe"]).toContain("/digests/unsubscribe?token=");
    await deliverNotification(db, config);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    await requestSubscription(db, {email: "uncertain@example.org", weekly: true, instant: false});
    smtp.sendMail.mockRejectedValueOnce(new Error("Connection closed after SMTP DATA"));
    await deliverNotification(db, config);
    await deliverNotification(db, config);
    expect(smtp.sendMail).toHaveBeenCalledTimes(2);
    expect((await db.select().from(notificationDelivery)).map(row => row.status).sort()).toEqual(["sent", "uncertain"]);
    await requestSubscription(db, {email: "expired@example.org", weekly: true, instant: false}, new Date("2020-01-01T00:00:00Z"));
    await deliverNotification(db, config);
    expect(smtp.sendMail).toHaveBeenCalledTimes(2);
    expect((await db.select().from(notificationDelivery)).map(row => row.status)).toContain("skipped");
  });
}, 120_000);


it("publishes only saved weekly editions, preserving their metadata and hiding unfinished summaries", async () => {
  await withIsolatedPublicationDatabase(async db => {
    const windowStart = new Date("2026-09-01T00:00:00Z");
    const windowEnd = new Date("2026-09-08T00:00:00Z");
    const [published] = await db.insert(notificationEdition).values({stream: "weekly", windowStart, windowEnd, publications: [], title: "Saved title", summary: "Saved summary", markdown: "Saved body", publishedAt: windowEnd}).returning();
    await db.insert(notificationEdition).values([
      {stream: "weekly", windowStart, windowEnd: new Date("2026-09-15T00:00:00Z"), publications: [], title: "Private title"},
      {stream: "hourly", windowStart, windowEnd, publications: [], title: "Email only", publishedAt: windowEnd},
    ]);
    const archive = await getDigestPageData(db, config, "en-GB", published.id);
    expect(archive.editions.map(edition => edition.slug)).toEqual([published.id]);
    expect(archive.edition).toMatchObject({title: "Saved title", summary: "Saved summary", markdown: "Saved body"});
    const [unfinished] = await db.select().from(notificationEdition).where(eq(notificationEdition.title, "Private title"));
    expect((await getDigestPageData(db, config, "en-GB", unfinished.id)).edition).toBeUndefined();
    expect((await getDigestPageData(db, config, "en-GB", "not-a-uuid")).edition).toBeUndefined();
    expect((await getDigestPageData(db, {...config, notifications: {...config.notifications, enabled: false}}, "en-GB")).nextEdition).toBeNull();
  });
}, 120_000);

it("retries pre-connection SMTP failures and lets confirmed readers recover preferences without resubscribing", async () => {
  await withIsolatedPublicationDatabase(async (db, client) => {
    smtp.sendMail.mockReset().mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), {command: "CONN", code: "ESOCKET"}));
    await requestSubscription(db, {email: "recover@example.org", weekly: true, instant: false});
    await deliverNotification(db, config);
    expect((await db.select().from(notificationDelivery))[0]).toMatchObject({status: "queued", attempts: 1, sendStartedAt: null});
    await client.query('UPDATE "notificationDelivery" SET "nextAttemptAt" = now()');
    smtp.sendMail.mockResolvedValue({accepted: ["recover@example.org"]});
    await deliverNotification(db, config);
    expect((await db.select().from(notificationDelivery))[0].status).toBe("sent");
    const [subscriber] = await db.select().from(notificationSubscriber);
    await confirmSubscription(db, subscriber.token);
    await updateSubscription(db, subscriber.token, {weekly: false, instant: false});
    await client.query('UPDATE "notificationSubscriber" SET "confirmationRequestedAt" = now() - interval \'2 days\'');
    await requestSubscription(db, {email: subscriber.email, weekly: true, instant: true});
    await deliverNotification(db, config);
    expect((await db.select().from(notificationSubscriber))[0]).toMatchObject({weekly: false, instant: false, token: subscriber.token});
    expect(smtp.sendMail.mock.lastCall?.[0].text).toContain(`/digests/preferences?token=${subscriber.token}`);
    expect(smtp.sendMail.mock.lastCall?.[0].text).not.toContain("/digests/confirm");
    expect((await db.select().from(notificationDelivery)).filter(row => row.status === "sent")).toHaveLength(2);
  });
}, 120_000);

it("stops retrying a digest after six failed generation attempts", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await db.insert(notificationEdition).values({stream: "weekly", windowStart: new Date("2026-09-01"), windowEnd: new Date("2026-09-08"), publications: [], attempts: 5});
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
