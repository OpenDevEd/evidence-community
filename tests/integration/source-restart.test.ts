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

it("measures a stage that started over from its new start", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ externalScopeKey: "restart-scope", key: "started-over", provider: "eprints", scopeKind: "repository" });
		await runSourceConnection({
			database: db,
			registry: new SourceAdapterRegistry([
				{
					provider: "eprints",
					sync: async ({ run }) => {
						await run!.report(600, 50_000, { missed: 10 });
						// The stage starts over, as a PDF stage does when it moves to date slices.
						await run!.report(0, 50_000, { missed: 0 });
						await run!.report(40, 50_000, { missed: 1 });
						return { synchronized: 1 };
					},
				},
			]),
			sourceConnectionKey: "started-over",
			workerId: "source-sync",
		});
		const [run] = await db
			.select({ recordsDone: sourceSyncRun.recordsDone, recordsFrom: sourceSyncRun.recordsFrom, stage: sourceSyncRun.stage })
			.from(sourceSyncRun)
			.where(eq(sourceSyncRun.sourceConnectionKey, "started-over"));
		expect(run).toEqual({ recordsDone: 40, recordsFrom: 0, stage: "pdfs" });
	});
}, 60_000);
