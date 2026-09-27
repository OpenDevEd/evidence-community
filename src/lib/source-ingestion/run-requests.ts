import {
	sourceConnection,
	sourceSyncState,
} from "@opendeved/evidence-library-core";
import { and, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";

export type SourceRunRequest = "requested" | "not_found" | "not_active";

/** Asks the source worker to run a source now instead of at its next sweep. */
export async function requestSourceRun(
	database: Database,
	sourceConnectionKey: string,
	now = new Date(),
): Promise<SourceRunRequest> {
	const [connection] = await database
		.select({ provider: sourceConnection.provider, status: sourceConnection.status })
		.from(sourceConnection)
		.where(eq(sourceConnection.key, sourceConnectionKey))
		.limit(1);
	if (!connection || connection.provider === NATIVE_SOURCE_CONNECTION_KEY) return "not_found";
	if (connection.status !== "active") return "not_active";
	await database
		.insert(sourceSyncState)
		.values({ runRequestedAt: now, sourceConnectionKey, updatedAt: now })
		.onConflictDoUpdate({
			set: { runRequestedAt: now, updatedAt: now },
			target: sourceSyncState.sourceConnectionKey,
		});
	return "requested";
}

/**
 * Whether a requested run can start. A source that is running already keeps
 * its request for after, so it does not wake the worker every few seconds.
 */
export async function hasRunnableSourceRequest(database: Database, now = new Date()) {
	const [row] = await database
		.select({ found: sql<number>`1` })
		.from(sourceSyncState)
		.innerJoin(sourceConnection, eq(sourceConnection.key, sourceSyncState.sourceConnectionKey))
		.where(
			and(
				// A request left on a source paused since then must not wake the worker.
				eq(sourceConnection.status, "active"),
				isNotNull(sourceSyncState.runRequestedAt),
				or(isNull(sourceSyncState.leaseExpiresAt), lte(sourceSyncState.leaseExpiresAt, now)),
			),
		)
		.limit(1);
	return row !== undefined;
}
