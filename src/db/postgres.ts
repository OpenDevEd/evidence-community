import { outbox } from "@opendeved/evidence-library-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { OutboxEvent } from "@/lib/cache-invalidation";
import { schema, type Database, type DatabaseTransaction } from "./database-schema";

const MAX_DATABASE_CONNECTIONS = 3;

type OutboxRow = typeof outbox.$inferInsert;

// Global, because Next can load this module once per bundle layer in the same process.
const globalOutbox = globalThis as typeof globalThis & {
	__evidenceLibraryPendingOutboxEvents?: WeakMap<DatabaseTransaction, OutboxEvent[]>;
};
/** Outbox rows written by each open transaction, handed to `afterOutboxCommit` once it commits. */
const pendingOutboxEvents = (globalOutbox.__evidenceLibraryPendingOutboxEvents ??= new WeakMap());

// Nested transactions (savepoints) add to the rows of the transaction that commits them.
function trackOutboxEvents(transaction: DatabaseTransaction, events: OutboxEvent[]) {
	pendingOutboxEvents.set(transaction, events);
	const nested = transaction.transaction.bind(transaction);
	transaction.transaction = ((run: Parameters<typeof nested>[0]) =>
		nested((inner) => {
			trackOutboxEvents(inner, events);
			return run(inner);
		})) as DatabaseTransaction["transaction"];
}

/**
 * Every public record change writes outbox rows through this, so a committed
 * change always reaches the cache clearing. Chain `.onConflictDoUpdate` as usual.
 */
export function insertOutboxEvents(
	transaction: DatabaseTransaction,
	rows: OutboxRow | OutboxRow[],
) {
	const events = pendingOutboxEvents.get(transaction);
	if (!events) {
		throw new Error(
			"Outbox rows must be written in a transaction from createPostgresDatabaseResource",
		);
	}
	const values = [rows].flat();
	events.push(...values);
	return transaction.insert(outbox).values(values);
}

export function createPostgresDatabaseResource(
	databaseUrl: string,
	afterOutboxCommit?: (events: OutboxEvent[]) => Promise<void>,
) {
	const pool = new Pool({
		connectionString: databaseUrl,
		max: MAX_DATABASE_CONNECTIONS,
		idleTimeoutMillis: 5_000,
		connectionTimeoutMillis: 5_000,
	});
	const database = drizzle({ client: pool, schema });
	const transaction = database.transaction.bind(database);
	database.transaction = (async (run, config) => {
		const events: OutboxEvent[] = [];
		const result = await transaction((tx) => {
			trackOutboxEvents(tx, events);
			return run(tx);
		}, config);
		if (events.length > 0) await afterOutboxCommit?.(events);
		return result;
	}) as Database["transaction"];

	return {
		database,
		dispose: () => pool.end(),
		pool,
	};
}
