import { normalizeDoi } from "@/lib/doi";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { itemSourceLink, sourceConnection } from "@/db/schema/source";
import { OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";
import { topicAssociationDelivery, topicDeliveryConfiguration } from "@/db/schema/topics";
import { getPublicItemCards } from "@/lib/public-item-card";
import { readPublicItems } from "@/lib/search-index/projection";
import { buildSiteUrl } from "@/lib/site-url";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { drainAssociationQueue, postOpenScholarAssociation, runAssociationDeliveryCycle, type AssociationJob } from "@/lib/publication/association-queue";
import { topicAssociationBatchReceiptSchema, topicAssociationRequestSchema } from "./contract";

type PublicCard = Awaited<ReturnType<typeof getPublicItemCards>>[number];
type PublicRecord = Awaited<ReturnType<typeof readPublicItems>>[number];
type TopicDelivery = ReturnType<typeof topicAssociationRequestSchema.parse>;

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
function publicPdfOf(record: PublicRecord | undefined, key: string, config: LibraryServerConfig): PublicPdf {
  // As the record's page shows them: a stored PDF with its cover, or a PDF link its source published.
  const pdfs = (record?.attachmentsData ?? []).filter(attachment => attachment.contentType?.toLowerCase() === "application/pdf" && isVisiblePdfAttachment(attachment));
  const pdf = pdfs.find(attachment => attachment.PDFCoverPageImage) ?? pdfs[0];
  if (!pdf) return null;
  const base = config.identity.baseUrl;
  const stored = pdf.linkMode?.startsWith("imported") || !pdf.url;
  const url = stored ? buildSiteUrl(`/lib/${key}/download/${pdf.key}`, base) : addressOf(pdf.url, base);
  return url ? {url, cover: addressOf(pdf.PDFCoverPageImage, base)} : null;
}

/**
 * What a delivery depends on besides the record. 2: a record goes to Openscholar's paper pages whether Topics is on or
 * not, so every community sends each of its records once more.
 */
const DELIVERY_FORMAT = 2;

async function reconcileVisibility(database: Database, config: LibraryServerConfig) {
  const signature = JSON.stringify([DELIVERY_FORMAT, config.topics.enabled, config.content.tags.hidden, config.authentication.openScholar.libraryId, config.identity.baseUrl]);
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

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Most records one call carries, the longest body it builds up to, and its most weight, a record weighing one plus its
 * topics: Openscholar saves a call in one transaction, which may make 4,096 index reads (OpenDevEd/openalex-count#1258).
 */
const BATCH_MAX = 50;
const BATCH_BODY_MAX = 1_000_000;
const BATCH_WEIGHT_MAX = 300;
const weightOf = (delivery: TopicDelivery) => 1 + delivery.topicIds.length;

/**
 * What each record's delivery says now: its topics, its public metadata with its PDF and cover, and its OpenAlex work;
 * or why it can't be sent, for that record alone.
 */
async function deliveriesOf(tx: Transaction, database: Database, config: LibraryServerConfig, jobs: AssociationJob[]): Promise<(TopicDelivery | Error)[]> {
  const keys = jobs.map(job => job.itemKey);
  // Topics off, the record still goes, without its topics (the card leaves them out), so its paper page lists this community.
  const cards = new Map((await getPublicItemCards(tx, keys, config)).map(card => [card.key, card]));
  const records = new Map((await readPublicItems(database, [...cards.keys()], config)).map(record => [record.key, record]));
  const sources = new Map<string, string>();
  for (const row of await tx.select({itemKey: itemSourceLink.itemKey, id: itemSourceLink.sourceRecordKey}).from(itemSourceLink)
    .innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
    .where(and(inArray(itemSourceLink.itemKey, keys), inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS)))) {
    if (!sources.has(row.itemKey)) sources.set(row.itemKey, row.id);
  }
  const libraryId = config.authentication.openScholar.libraryId;
  return jobs.map(job => {
    const card = cards.get(job.itemKey) ?? null;
    const source = sources.get(job.itemKey);
    const parsed = topicAssociationRequestSchema.safeParse({contractVersion: 1,
      idempotencyKey: `${libraryId}:${job.itemKey}:${job.generation}`,
      libraryId, itemKey: job.itemKey, generation: Number(job.generation),
      publishedRevision: Math.max(Number(job.revision), card?.revision ?? 0),
      openalexId: source && /^W[1-9]\d*$/.test(source) ? source : null,
      ...publicationFields(card, card ? publicPdfOf(records.get(job.itemKey), job.itemKey, config) : null),
    });
    return parsed.success ? parsed.data : new Error(`Topic delivery is invalid: ${parsed.error.message.slice(0, 1000)}`);
  });
}

/** The deliveries in calls within BATCH_MAX, BATCH_WEIGHT_MAX and about BATCH_BODY_MAX characters; a larger record goes alone. */
function batchesOf<T extends {delivery: TopicDelivery}>(entries: T[]) {
  const batches: T[][] = [];
  let size = 0;
  let weight = 0;
  for (const entry of entries) {
    const length = JSON.stringify(entry.delivery).length;
    const last = batches.at(-1);
    if (last && last.length < BATCH_MAX && size + length <= BATCH_BODY_MAX && weight + weightOf(entry.delivery) <= BATCH_WEIGHT_MAX) {
      last.push(entry); size += length; weight += weightOf(entry.delivery);
    } else { batches.push([entry]); size = length; weight = weightOf(entry.delivery); }
  }
  return batches;
}

/** Sends waiting records to Openscholar's paper pages, a batch a call, for up to five seconds; true when it sent any. */
export async function runTopicAssociationCycle(database: Database, config: LibraryServerConfig, signal?: AbortSignal, request: typeof fetch = fetch) {
  await reconcileVisibility(database, config);
  return drainAssociationQueue(() => runAssociationDeliveryCycle(database, "topicAssociationDelivery", async (jobs, leaseToken) => {
    // Each body is kept once built, so a retry sends the same one under the same key.
    const deliveries = await database.transaction(async tx => {
      const current = new Map((await tx.select().from(topicAssociationDelivery)
        .where(and(inArray(topicAssociationDelivery.itemKey, jobs.map(job => job.itemKey)), eq(topicAssociationDelivery.leaseToken, leaseToken)))
        .for("update")).map(row => [row.itemKey, row]));
      const unbuilt = jobs.filter(job => current.has(job.itemKey) && !current.get(job.itemKey)!.payload);
      const made = new Map((await deliveriesOf(tx, database, config, unbuilt)).map((delivery, index) => [unbuilt[index]!.itemKey, delivery]));
      for (const delivery of made.values()) {
        if (!(delivery instanceof Error)) await tx.update(topicAssociationDelivery).set({payload: delivery}).where(eq(topicAssociationDelivery.itemKey, delivery.itemKey));
      }
      return jobs.map(job => {
        const row = current.get(job.itemKey);
        return row?.payload ? topicAssociationRequestSchema.parse(row.payload) : made.get(job.itemKey) ?? null;
      });
    });
    // A record whose lease another worker took is that worker's to send; one that can't be built waits alone.
    const errors: unknown[] = deliveries.map(delivery => delivery instanceof Error ? delivery : null);
    const libraryId = config.authentication.openScholar.libraryId;
    for (const batch of batchesOf(deliveries.flatMap((delivery, index) => delivery && !(delivery instanceof Error) ? [{delivery, index}] : []))) {
      try {
        const response = await postOpenScholarAssociation(config, "/api/v1/evidence-libraries/topic-associations/batch", "topic delivery",
          {contractVersion: 1, libraryId, deliveries: batch.map(entry => entry.delivery)}, signal, request);
        const {receipts} = topicAssociationBatchReceiptSchema.parse(await response.json());
        if (receipts.length !== batch.length) throw new Error("Topic association receipts did not match the batch");
        for (const [at, {delivery, index}] of batch.entries()) {
          const receipt = receipts[at]!;
          if (receipt.idempotencyKey !== delivery.idempotencyKey || receipt.generation !== delivery.generation) errors[index] = new Error("Topic association receipt did not match the delivery");
          else if ("error" in receipt) errors[index] = new Error(`Openscholar refused the topic delivery: ${receipt.error.code}`);
        }
      } catch (error) {
        for (const {index} of batch) errors[index] = error;
      }
    }
    return errors;
  }, BATCH_MAX), signal);
}
