import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/database-schema";
import { notificationDelivery, notificationSubscriber } from "@/db/schema/notifications";

export const preferenceSchema = z.object({digest: z.boolean(), instant: z.boolean()}).strict();
export const signupSchema = preferenceSchema.extend({email: z.string().trim().email().max(254).transform(value => value.toLowerCase())}).refine(value => value.digest || value.instant, "Choose an email subscription");
export const subscriberTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Repeated public signup cannot change a confirmed subscriber's preferences. */
export async function requestSubscription(db: Database, input: z.infer<typeof signupSchema>, now = new Date()) {
  const value = signupSchema.parse(input);
  await db.transaction(async tx => {
    const inserted = await tx.insert(notificationSubscriber).values({ ...value, token: randomBytes(32).toString("hex"), confirmationRequestedAt: now, confirmationExpiresAt: new Date(now.getTime() + 86_400_000) }).onConflictDoNothing().returning();
    let subscriber = inserted[0];
    if (!subscriber) {
      const [existing] = await tx.select().from(notificationSubscriber).where(eq(notificationSubscriber.email, value.email)).for("update");
      if (!existing || existing.confirmationRequestedAt.getTime() > now.getTime() - 86_400_000) return;
      const [updated] = await tx.update(notificationSubscriber).set({ ...(existing.confirmedAt ? {} : { digest: value.digest, instant: value.instant, token: randomBytes(32).toString("hex") }), confirmationRequestedAt: now, confirmationExpiresAt: new Date(now.getTime() + 86_400_000), updatedAt: now }).where(eq(notificationSubscriber.id, existing.id)).returning();
      subscriber = updated;
      await tx.update(notificationDelivery).set({ status: "skipped", nextAttemptAt: null }).where(and(eq(notificationDelivery.subscriberId, existing.id), isNull(notificationDelivery.editionId), eq(notificationDelivery.status, "queued")));
    }
    await tx.insert(notificationDelivery).values({ messageKey: `confirmation:${subscriber.id}:${subscriber.confirmationRequestedAt.getTime()}`, subscriberId: subscriber.id }).onConflictDoNothing();
  });
}

export async function readSubscription(db: Database, token: string) {
  if (!subscriberTokenSchema.safeParse(token).success) return null;
  const [row] = await db.select().from(notificationSubscriber).where(eq(notificationSubscriber.token, token)).limit(1);
  return row ?? null;
}

export async function confirmSubscription(db: Database, token: string, now = new Date()) {
  if (!subscriberTokenSchema.safeParse(token).success) return false;
  const rows = await db.update(notificationSubscriber).set({ confirmedAt: sql`coalesce(${notificationSubscriber.confirmedAt}, ${now})`, updatedAt: now }).where(and(eq(notificationSubscriber.token, token), gt(notificationSubscriber.confirmationExpiresAt, now))).returning({id: notificationSubscriber.id});
  return rows.length > 0;
}

export async function updateSubscription(db: Database, token: string, input: z.infer<typeof preferenceSchema>) {
  if (!subscriberTokenSchema.safeParse(token).success) return false;
  const preferences = preferenceSchema.parse(input);
  return db.transaction(async tx => {
    const [subscriber] = await tx.select().from(notificationSubscriber).where(eq(notificationSubscriber.token, token)).for("update");
    if (!subscriber) return false;
    // Unsubscribe is always allowed, including an unconfirmed address.
    if (!subscriber.confirmedAt && (preferences.digest || preferences.instant)) return false;
    await tx.update(notificationSubscriber).set({...preferences, updatedAt: new Date()}).where(eq(notificationSubscriber.id, subscriber.id));
    await tx.execute(sql`UPDATE "notificationDelivery" d SET "status" = 'skipped', "nextAttemptAt" = NULL
      WHERE d."subscriberId" = ${subscriber.id}::uuid AND d."status" = 'queued' AND (
        (NOT ${preferences.digest} AND NOT ${preferences.instant}) OR EXISTS (
          SELECT 1 FROM "notificationEdition" e WHERE e."id" = d."editionId" AND
            ((e."stream" = 'digest' AND NOT ${preferences.digest}) OR (e."stream" = 'hourly' AND NOT ${preferences.instant}))
        )
      )`);
    return true;
  });
}
