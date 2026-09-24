import { normalizeDoi } from "@/lib/doi";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { itemSourceLink, sourceConnection } from "@/db/schema/source";
import { topicAssociationDelivery, topicDeliveryConfiguration } from "@/db/schema/topics";
import { getPublicItemCard } from "@/lib/public-item-card";
import { runAssociationDeliveryCycle } from "@/lib/publication/association-queue";
import { topicAssociationReceiptSchema, topicAssociationRequestSchema } from "./contract";

async function reconcileVisibility(database: Database, config: LibraryServerConfig) {
  const signature = JSON.stringify([config.topics.enabled, config.content.tags.hidden, config.authentication.openScholar.libraryId, config.identity.baseUrl]);
  await database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('new-el:topic-visibility', 0))`);
    const [previous] = await tx.select().from(topicDeliveryConfiguration).where(eq(topicDeliveryConfiguration.key, "active")).limit(1);
    if (previous && (previous.signature === signature || previous.revisionAt.getTime() > Date.parse(config.updatedAt))) return;
    await tx.execute(sql`INSERT INTO "topicAssociationDelivery" ("itemKey", "revision")
      SELECT "key", "revision" FROM "item" WHERE "parentItem" IS NULL
      ON CONFLICT ("itemKey") DO UPDATE SET "generation" = "topicAssociationDelivery"."generation" + 1,
        "revision" = EXCLUDED."revision", "payload" = NULL, "attempts" = 0, "nextAttemptAt" = now(),
        "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL`);
    const values = {key: "active", signature, revisionAt: new Date(config.updatedAt)};
    await tx.insert(topicDeliveryConfiguration).values(values).onConflictDoUpdate({target: topicDeliveryConfiguration.key, set: values});
  });
}

export async function runTopicAssociationCycle(database: Database, config: LibraryServerConfig, signal?: AbortSignal, request: typeof fetch = fetch) {
  await reconcileVisibility(database, config);
  return runAssociationDeliveryCycle(database, "topicAssociationDelivery", async (job, leaseToken) => {
    const payload = await database.transaction(async tx => {
      const [current] = await tx.select().from(topicAssociationDelivery).where(and(eq(topicAssociationDelivery.itemKey, job.itemKey), eq(topicAssociationDelivery.leaseToken, leaseToken))).for("update").limit(1);
      if (!current) return null;
      if (current.payload) return topicAssociationRequestSchema.parse(current.payload);
      const card = config.topics.enabled ? await getPublicItemCard(tx, job.itemKey, config) : null;
      const [source] = await tx.select({id: itemSourceLink.sourceRecordKey}).from(itemSourceLink)
        .innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
        .where(and(eq(itemSourceLink.itemKey, job.itemKey), eq(sourceConnection.provider, "openalex"))).limit(1);
      const data = topicAssociationRequestSchema.parse({contractVersion: 1,
        idempotencyKey: `${config.authentication.openScholar.libraryId}:${job.itemKey}:${job.generation}`,
        libraryId: config.authentication.openScholar.libraryId, itemKey: job.itemKey, generation: Number(job.generation),
        publishedRevision: Math.max(Number(job.revision), card?.revision ?? 0), state: card ? "published" : "unpublished",
        topicIds: card?.topics ?? [], openalexId: source?.id && /^W[1-9]\d*$/.test(source.id) ? source.id : null,
        doi: normalizeDoi(card?.DOI), metadata: card ? {title: (card.title ?? "").slice(0, 10000), date: card.date?.slice(0, 500) ?? null,
          itemType: card.itemType, creators: (card.creators ?? []).map(creator => (creator.name ?? [creator.firstName, creator.lastName].filter(Boolean).join(" ")).slice(0, 1000)),
          abstract: card.abstractNote?.slice(0, 100000) ?? null} : null,
      });
      await tx.update(topicAssociationDelivery).set({payload: data}).where(eq(topicAssociationDelivery.itemKey, job.itemKey));
      return data;
    });
    if (!payload) return;
    const service = config.authentication.openScholar;
    const response = await request(new URL("/api/v1/evidence-libraries/topic-associations", service.convexSiteUrl), {
      method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${service.machineCredential}`}, body: JSON.stringify(payload),
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(`OpenScholar topic delivery returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const receipt = topicAssociationReceiptSchema.parse(await response.json());
    if (receipt.idempotencyKey !== payload.idempotencyKey || receipt.generation !== payload.generation) throw new Error("Topic association receipt did not match the delivery");
  });
}
