import { sql } from "drizzle-orm";

import type { Database } from "./database-schema";

export type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];

export class DatabaseOperationAbortedError extends Error {
	constructor(options?: { cause?: unknown }) {
		super("Database operation was aborted", options);
		this.name = "DatabaseOperationAbortedError";
	}
}

export async function withCancellableDatabaseTransaction<T>(
	database: Database,
	signal: AbortSignal | undefined,
	operation: (transaction: DatabaseTransaction) => Promise<T>,
) {
	if (!signal) return database.transaction(operation);
	if (signal.aborted) throw new DatabaseOperationAbortedError();

	return database.transaction(async (transaction) => {
		const backend = await transaction.execute<{ pid: number }>(
			sql`select pg_backend_pid()::int as pid`,
		);
		const backendPid = backend.rows[0]?.pid;
		if (!backendPid)
			throw new Error("PostgreSQL backend PID was unavailable");

		let cancellation = Promise.resolve<unknown>(undefined);
		let cancellationRequested = false;
		const cancel = () => {
			if (cancellationRequested) return;
			cancellationRequested = true;
			cancellation = Promise.resolve(
				database.execute(sql`select pg_cancel_backend(${backendPid})`),
			);
		};
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();

		try {
			const result = await operation(transaction);
			if (signal.aborted) throw new DatabaseOperationAbortedError();
			return result;
		} catch (error) {
			if (signal.aborted) {
				throw new DatabaseOperationAbortedError({ cause: error });
			}
			throw error;
		} finally {
			signal.removeEventListener("abort", cancel);
			await cancellation.catch(() => undefined);
		}
	});
}
