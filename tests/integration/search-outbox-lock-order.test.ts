import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { setTimeout as delay } from "node:timers/promises";

import { outbox } from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import type { Index } from "meilisearch";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	SearchOutboxAbortError,
	processNextSearchOutboxBatch,
} from "@/lib/search-index/consumer";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

it("renews a worker's leases while an import locks the same search events in key order", async () => {
	await withIsolatedPublicationDatabase(async (db, importConnection) => {
		// Row ids run opposite to key order, the order imports lock events in.
		await db.insert(outbox).values([
			{ entityType: "item", entityKey: "BBBBBBBB", operation: "upsert", revision: 1 },
			{ entityType: "item", entityKey: "AAAAAAAA", operation: "upsert", revision: 1 },
		]);

		let claimed!: () => void;
		const workerClaimed = new Promise<void>((resolve) => { claimed = resolve; });
		let finishIndexing!: () => void;
		const indexing = new Promise<void>((resolve) => { finishIndexing = resolve; });
		const stop = new AbortController();
		const worker = processNextSearchOutboxBatch({
			database: db,
			// Never reached: the worker is stopped before it indexes.
			config: {} as LibraryServerConfig,
			index: {} as Index,
			workerId: "search-worker",
			heartbeatIntervalMs: 100,
			leaseDurationMs: 60_000,
			signal: stop.signal,
			onProgress: async () => {
				claimed();
				await indexing;
			},
		});
		await workerClaimed;

		const lockEvent = (key: string) => importConnection.query(`SELECT id FROM "outbox" WHERE "entityKey" = $1 ORDER BY "entityKey" FOR UPDATE`, [key]);
		await importConnection.query("BEGIN");
		await lockEvent("AAAAAAAA");
		// Wait until the worker's heartbeat is queued behind the import.
		for (let waited = 0; ; waited += 20) {
			const blocked = await db.execute<{ waiting: number }>(sql`SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`);
			if (blocked.rows[0]!.waiting > 0) break;
			if (waited > 5_000) throw new Error("The heartbeat never reached the locked event");
			await delay(20);
		}
		await lockEvent("BBBBBBBB");
		await importConnection.query("COMMIT");

		finishIndexing();
		stop.abort();
		// A heartbeat that lost a deadlock fails the batch instead of releasing it.
		await expect(worker).rejects.toBeInstanceOf(SearchOutboxAbortError);
		const events = await db.select({ leaseOwner: outbox.leaseOwner, lastError: outbox.lastError }).from(outbox);
		expect(events).toEqual([
			{ leaseOwner: null, lastError: null },
			{ leaseOwner: null, lastError: null },
		]);
	});
}, 60_000);
