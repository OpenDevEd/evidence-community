import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { notificationDelivery, notificationEdition, notificationSubscriber } from "@/db/schema/notifications";
import { sendNotificationEmail } from "@/lib/nodemailer";
import { notificationMessage } from "./message";

type Subscriber = typeof notificationSubscriber.$inferSelect;
type Edition = typeof notificationEdition.$inferSelect;
type Delivery = typeof notificationDelivery.$inferSelect;
type OwnedDelivery = ReturnType<typeof and>;

function canSendEdition(subscriber: Subscriber, edition: Edition) {
  // An edition that is being written again emails nobody, even through a delivery claimed before the rewrite began.
  if (!subscriber.confirmedAt || !edition.publishedAt || edition.nextAttemptAt) return false;
  return edition.stream === "digest" ? subscriber.digest : subscriber.instant;
}

function canSendConfirmation(subscriber: Subscriber, messageKey: string) {
  if (!subscriber.confirmedAt && !subscriber.digest && !subscriber.instant) return false;
  return subscriber.confirmationExpiresAt > new Date() && messageKey === `confirmation:${subscriber.id}:${subscriber.confirmationRequestedAt.getTime()}`;
}

async function claimDelivery(db: Database) {
  await db.execute(sql`UPDATE "notificationDelivery" SET "status" = CASE WHEN "sendStartedAt" IS NULL THEN 'queued' ELSE 'uncertain' END,
    "lastError" = CASE WHEN "sendStartedAt" IS NULL THEN "lastError" ELSE 'Worker stopped during SMTP delivery; acceptance is unknown' END,
    "leaseToken" = NULL, "leaseExpiresAt" = NULL WHERE "status" = 'sending' AND "leaseExpiresAt" < now()`);
  const token = randomUUID();
  const claim = await db.execute<{ messageKey: string }>(sql`UPDATE "notificationDelivery" SET "status" = 'sending', "leaseToken" = ${token}, "leaseExpiresAt" = now() + interval '3 minutes'
    WHERE "messageKey" = (SELECT "messageKey" FROM "notificationDelivery" WHERE "status" = 'queued' AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt", "messageKey" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING "messageKey"`);
  if (!claim.rows[0]) return null;
  const owned = and(eq(notificationDelivery.messageKey, claim.rows[0].messageKey), eq(notificationDelivery.leaseToken, token));
  const [delivery] = await db.select().from(notificationDelivery).where(owned);
  return delivery ? {delivery, owned} : null;
}

function smtpErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") return { code: null, command: null };
  return { code: "responseCode" in error ? Number(error.responseCode) : null, command: "command" in error ? error.command : null };
}

function smtpFailure(error: unknown, sending: boolean, attempts: number) {
  const { code, command } = smtpErrorDetails(error);
  // CONN failures happen before the server can accept message content.
  const uncertain = sending && !code && command !== "CONN";
  const retry = !uncertain && attempts < 8 && (!code || code < 500);
  return {uncertain, retry};
}

async function recordFailure(db: Database, delivery: Delivery, owned: OwnedDelivery, error: unknown, sending: boolean) {
  const attempts = delivery.attempts + 1;
  const {uncertain, retry} = smtpFailure(error, sending, attempts);
  await db.update(notificationDelivery).set({ status: uncertain ? "uncertain" : retry ? "queued" : "failed", attempts, nextAttemptAt: retry ? new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** attempts)) : null, sendStartedAt: uncertain ? new Date() : null, leaseToken: null, leaseExpiresAt: null, lastError: String(error).slice(0, 2000) }).where(owned);
  console.error("Library email delivery failed", { messageKey: delivery.messageKey, error: String(error), uncertain });
}

async function sendClaimedDelivery(db: Database, config: LibraryServerConfig, delivery: Delivery, owned: OwnedDelivery) {
  let sending = false;
  try {
    // Locking the subscriber serializes preference changes with delivery admission.
    await db.transaction(async tx => {
      const [subscriber] = await tx.select().from(notificationSubscriber).where(eq(notificationSubscriber.id, delivery.subscriberId)).for("update");
      const edition = delivery.editionId ? (await tx.select().from(notificationEdition).where(eq(notificationEdition.id, delivery.editionId)))[0] : null;
      const allowed = subscriber && (edition ? canSendEdition(subscriber, edition) : canSendConfirmation(subscriber, delivery.messageKey));
      if (!allowed) {
        await tx.update(notificationDelivery).set({ status: "skipped", nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null }).where(owned);
        return;
      }
      const message = await notificationMessage(config, subscriber, edition ?? null, delivery.messageKey);
      // Commit the marker outside this transaction so a process crash retains uncertainty.
      await db.update(notificationDelivery).set({ sendStartedAt: new Date() }).where(owned);
      sending = true;
      const result = await sendNotificationEmail(config, message);
      if (!result.accepted.length) throw Object.assign(new Error("SMTP rejected the recipient"), { responseCode: 550 });
      await tx.update(notificationDelivery).set({ status: "sent", sentAt: new Date(), nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null, lastError: null }).where(owned);
    });
  } catch (error) {
    await recordFailure(db, delivery, owned, error, sending);
  }
}

/** An ambiguous SMTP acceptance is kept for inspection instead of blindly sent twice. */
export async function deliverNotification(db: Database, config: LibraryServerConfig) {
  if (!config.notifications.enabled) return false;
  const claimed = await claimDelivery(db);
  if (!claimed) return false;
  await sendClaimedDelivery(db, config, claimed.delivery, claimed.owned);
  return true;
}
