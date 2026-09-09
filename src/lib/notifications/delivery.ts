import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { notificationDelivery, notificationEdition, notificationSubscriber } from "@/db/schema/notifications";
import { sendNotificationEmail } from "@/lib/nodemailer";
import { escapeHtml } from "@/lib/escape-html";
import { createSafeMarkdownRenderer } from "@/lib/markdown-html";

function subscriptionUrl(config: LibraryServerConfig, token: string, action = "preferences") {
  return new URL(`/${config.localization.defaultLocale}/digests/${action}?token=${token}`, config.identity.baseUrl).toString();
}

async function notificationMessage(config: LibraryServerConfig, subscriber: typeof notificationSubscriber.$inferSelect, edition: typeof notificationEdition.$inferSelect | null, messageKey: string) {
  const preferences = subscriptionUrl(config, subscriber.token);
  const unsubscribe = subscriptionUrl(config, subscriber.token, "unsubscribe");
  let subject: string, text: string, content: string;
  if (!edition && subscriber.confirmedAt) {
    subject = `Email preferences for ${config.identity.name}`;
    text = `Manage your email updates: ${preferences}`;
    content = `<h1>Email preferences</h1><p><a href="${escapeHtml(preferences)}">Manage email updates from ${escapeHtml(config.identity.name)}</a></p>`;
  } else if (!edition) {
    const confirm = subscriptionUrl(config, subscriber.token, "confirm");
    subject = `Confirm email updates from ${config.identity.name}`;
    text = `Confirm your email updates: ${confirm}\n\nThis link expires after 24 hours. If you did not subscribe, ignore this email.`;
    content = `<h1>Confirm your email</h1><p>Receive updates from ${escapeHtml(config.identity.name)}.</p><p><a href="${escapeHtml(confirm)}">Confirm email updates</a></p><p>This link expires after 24 hours. If you did not subscribe, ignore this email.</p>`;
  } else {
    subject = `${config.identity.shortName}: ${edition.title}`;
    const editionUrl = new URL(`/${config.localization.defaultLocale}/digests/${edition.id}`, config.identity.baseUrl).toString();
    const markdown = edition.stream === "weekly" ? edition.markdown! : edition.publications.map(publication => `## ${publication.title}\n\n${publication.creators.join(", ")}\n\n${publication.abstract ?? ""}\n\n[Read publication](/lib/${publication.key})`).join("\n\n");
    const render = await createSafeMarkdownRenderer(config.identity.baseUrl);
    content = `<h1>${escapeHtml(edition.title!)}</h1>${await render(markdown)}${edition.stream === "weekly" ? `<p><a href="${escapeHtml(editionUrl)}">Read this edition online</a></p>` : ""}`;
    text = `${edition.title}\n\n${markdown.replace(/\]\((\/lib\/[A-Z0-9]{8})\)/g, (_, href: string) => `](${new URL(href, config.identity.baseUrl)})`)}${edition.stream === "weekly" ? `\n\nRead online: ${editionUrl}` : ""}`;
  }
  const footer = `<p><a href="${escapeHtml(preferences)}">Email preferences</a> &nbsp; <a href="${escapeHtml(unsubscribe)}">Unsubscribe</a></p>`;
  return { to: subscriber.email, subject, text: `${text}\n\nEmail preferences: ${preferences}\nUnsubscribe: ${unsubscribe}`, html: `<!doctype html><html><body><main style="max-width:680px;margin:32px auto;font-family:Arial,sans-serif;line-height:1.65;color:#242424">${content}${footer}</main></body></html>`, messageId: `<${createHash("sha256").update(messageKey).digest("hex")}@${new URL(config.identity.baseUrl).hostname}>`, headers: { "List-Unsubscribe": `<${unsubscribe}>` } };
}

type Subscriber = typeof notificationSubscriber.$inferSelect;
type Edition = typeof notificationEdition.$inferSelect;
type Delivery = typeof notificationDelivery.$inferSelect;
type OwnedDelivery = ReturnType<typeof and>;

function canSendEdition(subscriber: Subscriber, edition: Edition) {
  if (!subscriber.confirmedAt || !edition.publishedAt) return false;
  return edition.stream === "weekly" ? subscriber.weekly : subscriber.instant;
}

function canSendConfirmation(subscriber: Subscriber, messageKey: string) {
  if (!subscriber.confirmedAt && !subscriber.weekly && !subscriber.instant) return false;
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
