import { normalizeDoi } from "@/lib/doi";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { itemSourceLink, sourceConnection } from "@/db/schema/source";
import { OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";
import { topicAssociationDelivery, topicDeliveryConfiguration } from "@/db/schema/topics";
import { getPublicItemCard } from "@/lib/public-item-card";
import { readPublicItem } from "@/lib/search-index/projection";
import { buildSiteUrl } from "@/lib/site-url";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { postOpenScholarAssociation, runAssociationDeliveryCycle } from "@/lib/publication/association-queue";
import { topicAssociationReceiptSchema, topicAssociationRequestSchema } from "./contract";

type PublicCard = NonNullable<Awaited<ReturnType<typeof getPublicItemCard>>>;

type PublicPdf = {url: string; cover: string | null} | null;

/** An unpublished item clears its topics; a published one sends its public metadata, its PDF and its cover with it. */
function publicationFields(card: PublicCard | null, pdf: PublicPdf) {
  if (!card) return {state: "unpublished", topicIds: [], doi: null, metadata: null};
  return {state: "published", topicIds: card.topics ?? [], doi: normalizeDoi(card.DOI),
    metadata: {title: (card.title ?? "").slice(0, 10000), date: card.date?.slice(0, 500) ?? null,
      itemType: card.itemType, creators: (card.creators ?? []).slice(0, 1000).map(creator => (creator.name ?? [creator.firstName, creator.lastName].filter(Boolean).join(" ")).slice(0, 1000)),
      abstract: card.abstractNote?.slice(0, 100000) ?? null, pdf}};
}

/** An address a reader can open, or none for one that isn't. */
const addressOf = (value: string | null | undefined, base: string) => {
  try {
    return value ? new URL(value, `${base}/`).href : null;
  } catch {
    return null;
  }
};

/**
 * The record's PDF and the picture of its first page, as its public page offers them: the PDF with a picture first. A
 * stored PDF is opened through the site's download route.
 */
async function publicPdfOf(database: Database, key: string, config: LibraryServerConfig): Promise<PublicPdf> {
  const record = await readPublicItem(database, key, config);
  // As the record's page shows them: a stored PDF with its cover, or a PDF link its source published.
  const pdfs = (record?.attachmentsData ?? []).filter(attachment => attachment.contentType?.toLowerCase() === "application/pdf" && isVisiblePdfAttachment(attachment));
  const pdf = pdfs.find(attachment => attachment.PDFCoverPageImage) ?? pdfs[0];
  if (!pdf) return null;
  const base = config.identity.baseUrl;
  const stored = pdf.linkMode?.startsWith("imported") || !pdf.url;
  const url = stored ? buildSiteUrl(`/lib/${key}/download/${pdf.key}`, base) : addressOf(pdf.url, base);
  return url ? {url, cover: addressOf(pdf.PDFCoverPageImage, base)} : null;
}

async function reconcileVisibility(database: Database, config: LibraryServerConfig) {
  const signature = JSON.stringify([config.topics.enabled, config.content.tags.hidden, config.authentication.openScholar.libraryId, config.identity.baseUrl]);
  await database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('new-el:topic-visibility', 0))`);
    const [previous] = await tx.select().from(topicDeliveryConfiguration).where(eq(topicDeliveryConfiguration.key, "active")).limit(1);
    if (previous && (previous.signature === signature || previous.revisionAt.getTime() > Date.parse(config.updatedAt))) return;
    // A library that has never had Topics on has no associations in OpenScholar to clear.
    if (previous || config.topics.enabled) await tx.execute(sql`INSERT INTO "topicAssociationDelivery" ("itemKey", "revision")
      SELECT "key", "revision" FROM "item" WHERE "parentItem" IS NULL
      ON CONFLICT ("itemKey") DO UPDATE SET "generation" = "topicAssociationDelivery"."generation" + 1,
        "revision" = EXCLUDED."revision", "payload" = NULL, "attempts" = 0, "nextAttemptAt" = now(),
        "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL`);
    const values = {key: "active", signature, revisionAt: new Date(config.updatedAt)};
    await tx.insert(topicDeliveryConfiguration).values(values).onConflictDoUpdate({target: topicDeliveryConfiguration.key, set: values});
  });
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What the record's delivery says now: its topics, its public metadata with its PDF and cover, and its OpenAlex work. */
async function deliveryOf(tx: Transaction, database: Database, config: LibraryServerConfig, job: {itemKey: string; generation: number | string; revision: number | string}) {
  const card = config.topics.enabled ? await getPublicItemCard(tx, job.itemKey, config) : null;
  const pdf = card ? await publicPdfOf(database, job.itemKey, config) : null;
  const [source] = await tx.select({id: itemSourceLink.sourceRecordKey}).from(itemSourceLink)
    .innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
    .where(and(eq(itemSourceLink.itemKey, job.itemKey), inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS))).limit(1);
  const libraryId = config.authentication.openScholar.libraryId;
  return topicAssociationRequestSchema.parse({contractVersion: 1,
    idempotencyKey: `${libraryId}:${job.itemKey}:${job.generation}`,
    libraryId, itemKey: job.itemKey, generation: Number(job.generation),
    publishedRevision: Math.max(Number(job.revision), card?.revision ?? 0),
    openalexId: source?.id && /^W[1-9]\d*$/.test(source.id) ? source.id : null,
    ...publicationFields(card, pdf),
  });
}

export async function runTopicAssociationCycle(database: Database, config: LibraryServerConfig, signal?: AbortSignal, request: typeof fetch = fetch) {
  await reconcileVisibility(database, config);
  const deadline = Date.now() + 5_000;
  let processed = false;
  do {
  if (signal?.aborted) break;
  const claimed = await runAssociationDeliveryCycle(database, "topicAssociationDelivery", async (job, leaseToken) => {
    const payload = await database.transaction(async tx => {
      const [current] = await tx.select().from(topicAssociationDelivery).where(and(eq(topicAssociationDelivery.itemKey, job.itemKey), eq(topicAssociationDelivery.leaseToken, leaseToken))).for("update").limit(1);
      if (!current) return null;
      if (current.payload) return topicAssociationRequestSchema.parse(current.payload);
      const data = await deliveryOf(tx, database, config, job);
      await tx.update(topicAssociationDelivery).set({payload: data}).where(eq(topicAssociationDelivery.itemKey, job.itemKey));
      return data;
    });
    if (!payload) return;
    const response = await postOpenScholarAssociation(config, "/api/v1/evidence-libraries/topic-associations", "topic delivery", payload, signal, request);
    const receipt = topicAssociationReceiptSchema.parse(await response.json());
    if (receipt.idempotencyKey !== payload.idempotencyKey || receipt.generation !== payload.generation) throw new Error("Topic association receipt did not match the delivery");
  });
  if (!claimed) break;
  processed = true;
  } while (Date.now() < deadline);
  return processed;
}
