import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";

/** Both publication feeds use the same lease and supersession rules. */
export async function runAssociationDeliveryCycle(
  database: Database,
  tableName: "authorAssociationDelivery" | "topicAssociationDelivery",
  deliver: (job: {itemKey: string; revision: number; generation: number}, leaseToken: string) => Promise<void>,
) {
  const token = randomUUID();
  const table = sql.identifier(tableName);
  const generation = sql.identifier(tableName === "topicAssociationDelivery" ? "generation" : "revision");
  const claimed = await database.execute<{itemKey: string; revision: number; generation: number; attempts: number}>(sql`
    UPDATE ${table} SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + interval '60 seconds'
    WHERE "itemKey" = (SELECT "itemKey" FROM ${table}
      WHERE "nextAttemptAt" <= now() AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
      ORDER BY "nextAttemptAt", "itemKey" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING "itemKey", "revision", ${generation} AS generation, "attempts"
  `);
  const job = claimed.rows[0];
  if (!job) return false;
  try {
    await deliver(job, token);
    await database.execute(sql`UPDATE ${table} SET "nextAttemptAt" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
      WHERE "itemKey" = ${job.itemKey} AND "leaseToken" = ${token}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts + 1;
    console.error("Publication association delivery failed", {queue: tableName, itemKey: job.itemKey, generation: job.generation, error: message});
    await database.execute(sql`UPDATE ${table} SET "attempts" = ${attempts},
      "nextAttemptAt" = ${new Date(Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)))},
      "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = ${message.slice(0, 2000)}
      WHERE "itemKey" = ${job.itemKey} AND "leaseToken" = ${token}`);
  }
  return true;
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
  if (!response.ok) throw new Error(`OpenScholar ${label} returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}
