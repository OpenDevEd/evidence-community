import { DrizzleQueryError } from "drizzle-orm";

/** The PostgreSQL error code behind a failed query, if it has one. */
export function databaseErrorCode(error: unknown) {
	const cause = error instanceof DrizzleQueryError ? error.cause : error;
	return (cause as { code?: string } | undefined)?.code;
}

/** A deadlock or serialization failure: PostgreSQL rolled the transaction back, so it can run again. */
export function isTransientConflict(error: unknown) {
	const code = databaseErrorCode(error);
	return code === "40P01" || code === "40001";
}

/** Runs a whole transaction again when PostgreSQL rolled it back to break a conflict. */
export async function retryTransientConflicts<T>(run: () => Promise<T>, attempts = 3) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await run();
		} catch (error) {
			if (attempt >= attempts || !isTransientConflict(error)) throw error;
		}
	}
}
