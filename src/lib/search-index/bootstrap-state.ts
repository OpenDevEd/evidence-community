import { eq } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { status } from "@/db/schema/tables/status";

export function shouldRebuildSearchIndex(input: {
	forceRebuild: boolean;
	indexCreated: boolean;
	rebuildPending: boolean;
}) {
	return input.forceRebuild || input.indexCreated || input.rebuildPending;
}

export async function searchIndexRebuildIsPending(database: Database) {
	const [row] = await database
		.select({ pending: status.searchIndexRebuildPending })
		.from(status)
		.where(eq(status.id, 1))
		.limit(1);
	if (!row) throw new Error("Library status row is missing.");
	return row.pending;
}

export async function setSearchIndexRebuildPending(
	database: Database,
	pending: boolean,
) {
	const [row] = await database
		.update(status)
		.set({ searchIndexRebuildPending: pending, updatedAt: new Date() })
		.where(eq(status.id, 1))
		.returning({ pending: status.searchIndexRebuildPending });
	if (!row) throw new Error("Library status row is missing.");
	return row.pending;
}
