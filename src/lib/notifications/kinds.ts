import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { notificationEdition, notificationItemKind } from "@/db/schema/notifications";
import { item } from "@/db/schema/tables/item";
import type { NotificationPublication, PublicationKind } from "./types";

/**
 * Telling meta-analyses and reviews from single studies. A title, an abstract or an OpenAlex type only suggests one,
 * so each record they catch is read once by Jev when a digest first covers it (OpenScholar does the reading while it
 * writes the digest), and the answer is kept with the record.
 */

// Wide on purpose: a miss loses a review, and a false catch costs one short read that answers "study".
const TITLE = "meta[-‐ ]?analy|\\yreview\\y|synthesis|scoping|bibliometric|state of the art|overview";
const ABSTRACT = "meta[-‐ ]?analy|systematic(ally)? review|scoping review|literature review|narrative review|umbrella review|rapid review|integrative review|evidence synthesis|this review|we review|prisma";

/** True for a record whose title, abstract or OpenAlex type suggests a meta-analysis or a review. */
const likelyReview = sql`(coalesce(${item.title}, '') ~* ${TITLE} OR coalesce(${item.abstractNote}, '') ~* ${ABSTRACT}
  OR EXISTS (SELECT 1 FROM "sourceSnapshot" WHERE "sourceSnapshot"."itemKey" = ${item.key} AND "sourceSnapshot"."payload" ->> 'type' = 'review'))`;

/** True for a record to list ahead of the rest: one read as a meta-analysis or a review, or a likely one nobody has read yet. */
export const listedAsReview = sql`coalesce((SELECT "kind" IN ('meta-analysis', 'review') FROM "notificationItemKind" WHERE "notificationItemKind"."itemKey" = ${item.key}), ${likelyReview})`;

export const publicationKindsSchema = z.record(z.string(), z.enum(["meta-analysis", "review", "study"]));
type Marks = Pick<NotificationPublication, "candidate" | "kind">;

/** For each record: whether it is a likely review, and what it was read as if it has been. */
export async function publicationMarks(db: DatabaseTransaction, keys: string[]) {
  if (!keys.length) return new Map<string, Marks>();
  const { rows } = await db.execute<{ key: string; candidate: boolean; kind: PublicationKind | null }>(sql`
    SELECT ${item.key} AS key, ${likelyReview} AS candidate, (SELECT "kind" FROM "notificationItemKind" WHERE "notificationItemKind"."itemKey" = ${item.key}) AS kind
    FROM ${item} WHERE ${item.key} = ANY(${sql`ARRAY[${sql.join(keys.map(key => sql`${key}`), sql`, `)}]::text[]`})`);
  return new Map(rows.map((row): [string, Marks] => [row.key, { candidate: row.candidate, ...(row.kind ? { kind: row.kind } : {}) }]));
}

// The edition's stored publications, each with what its record has been read as. Built in the database from what is
// stored now, so a list that was replaced while an answer was on its way is never put back.
const withKinds = sql`(
  SELECT coalesce(jsonb_agg(CASE WHEN read."kind" IS NULL THEN stored.entry ELSE stored.entry || jsonb_build_object('kind', read."kind") END ORDER BY stored.position), '[]'::jsonb)
  FROM jsonb_array_elements("notificationEdition"."publications") WITH ORDINALITY AS stored(entry, position)
  LEFT JOIN "notificationItemKind" read ON read."itemKey" = stored.entry->>'key')`;

/**
 * Keeps what the edition's likely reviews were read as: with each record, so it is never read again, and on the
 * edition's stored publications, which the next request sends. Answers for records the edition was not asked about are dropped.
 */
export async function savePublicationKinds(db: Database | DatabaseTransaction, edition: Pick<typeof notificationEdition.$inferSelect, "id" | "publications">, kinds: Record<string, PublicationKind> | undefined) {
  const read = edition.publications.flatMap(publication => (kinds?.[publication.key] ? [{ itemKey: publication.key, kind: kinds[publication.key]! }] : []));
  if (!read.length) return;
  // The first answer stands: two digests asked at once can both have a record read, and the second must not change what the first was told.
  await db.insert(notificationItemKind).values(read).onConflictDoNothing();
  await db.update(notificationEdition).set({ publications: withKinds }).where(eq(notificationEdition.id, edition.id));
}

/**
 * Marks the start of an attempt: the stored publications take on what their records have been read as since the
 * edition was listed, by another digest that covers them too, so none is read twice. Returns them as they are to be sent.
 */
export async function startDigestRequest(db: Database, editionId: string) {
  const [started] = await db.update(notificationEdition).set({ publications: withKinds, requestedAt: sql`now()` })
    .where(eq(notificationEdition.id, editionId)).returning({ publications: notificationEdition.publications });
  return started?.publications ?? [];
}
