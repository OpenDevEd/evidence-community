import { expect, it } from "vitest";

import { outbox, sourceConnection, sourceSyncRun } from "@opendeved/evidence-library-core";
import { enqueueItemSearchReprojections } from "@/lib/publication/queue";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

it("keeps a waiting run's search event at its first queue time, and restarts a finished one", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: "oa-requeue", provider: "openalex", scopeKind: "query", config: {} });
		const [run] = await db.insert(sourceSyncRun).values({ sourceConnectionKey: "oa-requeue", workerId: "test" }).returning({ id: sourceSyncRun.id });
		const queuedAt = new Date("2026-09-30T10:00:00Z");
		await db.insert(outbox).values([
			{ entityType: "item", entityKey: "WAITING1", operation: "upsert", revision: 1, sourceSyncRunId: run!.id, createdAt: queuedAt },
			{ entityType: "item", entityKey: "FINISHED", operation: "upsert", revision: 1, sourceSyncRunId: run!.id, createdAt: queuedAt, processedAt: queuedAt },
		]);

		// A PDF stage re-queues both without a run of its own.
		const later = new Date("2026-09-30T11:00:00Z");
		await db.transaction((transaction) =>
			enqueueItemSearchReprojections(transaction, [{ itemKey: "WAITING1", revision: 1 }, { itemKey: "FINISHED", revision: 1 }], later),
		);

		const rows = await db.select().from(outbox);
		const byKey = Object.fromEntries(rows.map((row) => [row.entityKey, row]));
		expect(byKey.WAITING1).toMatchObject({ createdAt: queuedAt, sourceSyncRunId: run!.id, processedAt: null });
		expect(byKey.FINISHED).toMatchObject({ createdAt: later, processedAt: null });
	});
});
