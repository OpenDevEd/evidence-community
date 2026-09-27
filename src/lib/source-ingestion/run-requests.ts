import { setTimeout as delay } from "node:timers/promises";

import {
	sourceConnection,
	sourceSyncState,
} from "@opendeved/evidence-library-core";
import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";

/** How often the worker looks for sources someone asked to run now. */
const RUN_REQUEST_CHECK_MS = 5_000;

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
 * Requested sources that can start now: active and not running. A source that
 * is running keeps its request for after; a paused one never starts.
 */
export async function listRunnableSourceRequests(
	database: Database,
	options: { now?: Date; only?: string } = {},
) {
	const now = options.now ?? new Date();
	const rows = await database
		.select({ key: sourceSyncState.sourceConnectionKey })
		.from(sourceSyncState)
		.innerJoin(sourceConnection, eq(sourceConnection.key, sourceSyncState.sourceConnectionKey))
		.where(
			and(
				eq(sourceConnection.status, "active"),
				isNotNull(sourceSyncState.runRequestedAt),
				or(isNull(sourceSyncState.leaseExpiresAt), lte(sourceSyncState.leaseExpiresAt, now)),
				options.only ? eq(sourceConnection.key, options.only) : undefined,
			),
		)
		.orderBy(asc(sourceSyncState.runRequestedAt))
		.limit(20);
	return rows.map(({ key }) => key);
}

/**
 * Runs requested sources as they come in, next to the regular sweep, so a
 * request never waits for a long import of another source. Claiming the run
 * clears the request; the lease keeps the sweep from running it twice.
 */
export async function runRequestedSources(options: {
	/** The requests that can start now, such as {@link listRunnableSourceRequests}. */
	list: () => Promise<string[]>;
	run: (sourceConnectionKey: string) => Promise<unknown>;
	onError: (error: unknown) => void;
	signal: AbortSignal;
	wait?: (milliseconds: number, signal: AbortSignal) => Promise<unknown>;
}) {
	const wait = options.wait ?? ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
	while (!options.signal.aborted) {
		const keys = await options.list().catch((error: unknown) => {
			options.onError(error);
			return [];
		});
		for (const key of keys) {
			if (options.signal.aborted) return;
			// One failed run must not hold up the others.
			await options.run(key).catch(options.onError);
		}
		await wait(RUN_REQUEST_CHECK_MS, options.signal).catch(() => undefined);
	}
}
