import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export type AssociationJob = {itemKey: string; revision: number; generation: number; attempts: number};

/**
 * Every feed to Openscholar uses the same lease and supersession rules. Claims up to `limit` waiting records under one
 * lease and hands them to `deliver`, which answers each in order: null once Openscholar has it, or why it didn't take
 * it, so that record alone waits and tries again. Returns how many it claimed.
 */
export async function runAssociationDeliveryCycle(
  database: Database,
  tableName: "authorAssociationDelivery" | "topicAssociationDelivery" | "submissionStatusDelivery",
  deliver: (jobs: AssociationJob[], leaseToken: string) => Promise<unknown[]>,
  limit = 1,
) {
  const token = randomUUID();
  const table = sql.identifier(tableName);
  const generation = sql.identifier(tableName === "authorAssociationDelivery" ? "revision" : "generation");
  const {rows: jobs} = await database.execute<AssociationJob>(sql`
    UPDATE ${table} SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + interval '60 seconds'
    WHERE "itemKey" IN (SELECT "itemKey" FROM ${table}
      WHERE "nextAttemptAt" <= now() AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
      ORDER BY "nextAttemptAt", "itemKey" FOR UPDATE SKIP LOCKED LIMIT ${limit})
    RETURNING "itemKey", "revision", ${generation} AS generation, "attempts"
  `);
  if (!jobs.length) return 0;
  let errors: unknown[];
  try {
    errors = await deliver(jobs, token);
  } catch (error) {
    errors = jobs.map(() => error);
  }
  const delivered = jobs.filter((_, index) => errors[index] == null).map(job => job.itemKey);
  if (delivered.length) {
    await database.execute(sql`UPDATE ${table} SET "nextAttemptAt" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
      WHERE "itemKey" IN (${sql.join(delivered.map(key => sql`${key}`), sql`, `)}) AND "leaseToken" = ${token}`);
  }
  for (const [index, job] of jobs.entries()) {
    const error = errors[index];
    if (error == null) continue;
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts + 1;
    console.error("Publication association delivery failed", {queue: tableName, itemKey: job.itemKey, generation: job.generation, error: message});
    await database.execute(sql`UPDATE ${table} SET "attempts" = ${attempts},
      "nextAttemptAt" = ${new Date(Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)))},
      "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = ${message.slice(0, 2000)}
      WHERE "itemKey" = ${job.itemKey} AND "leaseToken" = ${token}`);
  }
  return jobs.length;
}

/** Delivers each record on its own, all at once: null for each one delivered, or its error. */
export function eachAssociation(deliver: (job: AssociationJob, leaseToken: string) => Promise<void>) {
  return (jobs: AssociationJob[], leaseToken: string) => Promise.all(jobs.map(job => deliver(job, leaseToken).then(() => null, (error: unknown) => error)));
}

/** Runs a queue's cycles for up to five seconds, while it finds waiting records; true when it claimed any. */
export async function drainAssociationQueue(cycle: () => Promise<number>, signal?: AbortSignal) {
  const deadline = Date.now() + 5_000;
  let processed = false;
  while (Date.now() < deadline && !signal?.aborted) {
    if (!await cycle()) break;
    processed = true;
  }
  return processed;
}

/** Post one association payload to OpenScholar; a non-2xx reply throws so the queue retries. */
export async function postOpenScholarAssociation(
  config: LibraryServerConfig, path: string, label: string, body: unknown,
  signal?: AbortSignal, request: typeof fetch = fetch,
) {
  const service = config.authentication.openScholar;
  const response = await request(new URL(path, service.convexSiteUrl), {
    method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${service.machineCredential}`}, body: JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`Openscholar ${label} returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}
