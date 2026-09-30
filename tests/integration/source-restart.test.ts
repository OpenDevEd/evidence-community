import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sourceSyncRun, sourceSyncState } from "@opendeved/evidence-library-core";
import { asc, eq } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { sourceConnection } from "@/db/schema/source";
import { SourceAdapterRegistry } from "@/lib/source-ingestion/adapter";
import { releaseWorkerLeases, runSourceConnection } from "@/lib/source-ingestion/orchestrator";
import { listRunnableSourceRequests } from "@/lib/source-ingestion/run-requests";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

/** A source mid-import under a worker whose lease has minutes left. */
async function addLeasedSource(db: Database, key: string, workerId: string) {
	const startedAt = new Date(Date.now() - 60_000);
	await db.insert(sourceConnection).values({
		externalScopeKey: `${key}-scope`,
		key,
		provider: "eprints",
		scopeKind: "repository",
	});
	const [run] = await db
		.insert(sourceSyncRun)
		.values({ heartbeatAt: startedAt, sourceConnectionKey: key, startedAt, workerId })
		.returning({ id: sourceSyncRun.id });
	await db.insert(sourceSyncState).values({
		activeRunId: run!.id,
		lastAttemptAt: startedAt,
		leaseExpiresAt: new Date(Date.now() + 4 * 60_000),
		leaseOwner: workerId,
		sourceConnectionKey: key,
		updatedAt: startedAt,
	});
}

it("resumes the imports a restarted worker was running without waiting out their leases", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await addLeasedSource(db, "restarted", "source-sync");
		await addLeasedSource(db, "other-worker", "another-worker");

		expect(await releaseWorkerLeases(db, "source-sync")).toEqual(["restarted"]);
		// An old process still running can no longer renew the lease it held.
		const [released] = await db
			.select({ activeRunId: sourceSyncState.activeRunId, leaseOwner: sourceSyncState.leaseOwner })
			.from(sourceSyncState)
			.where(eq(sourceSyncState.sourceConnectionKey, "restarted"));
		expect(released).toEqual({ activeRunId: null, leaseOwner: null });
		expect(await listRunnableSourceRequests(db)).toEqual(["restarted"]);

		await runSourceConnection({
			database: db,
			registry: new SourceAdapterRegistry([{ provider: "eprints", sync: async () => ({ synchronized: 1 }) }]),
			sourceConnectionKey: "restarted",
			workerId: "source-sync",
		});
		const runs = await db
			.select({ error: sourceSyncRun.error, status: sourceSyncRun.status })
			.from(sourceSyncRun)
			.where(eq(sourceSyncRun.sourceConnectionKey, "restarted"))
			.orderBy(asc(sourceSyncRun.id));
		expect(runs).toEqual([
			{ error: "SourceLeaseLostError: worker lease expired", status: "failed" },
			{ error: null, status: "succeeded" },
		]);
		const [other] = await db
			.select({ leaseOwner: sourceSyncState.leaseOwner })
			.from(sourceSyncState)
			.where(eq(sourceSyncState.sourceConnectionKey, "other-worker"));
		expect(other).toEqual({ leaseOwner: "another-worker" });
	});
}, 60_000);
