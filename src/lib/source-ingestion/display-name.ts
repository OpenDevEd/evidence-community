import { sourceConnection } from "@opendeved/evidence-library-core";
import { eq } from "drizzle-orm";

import type { Database } from "@/db/database-schema";

/**
 * Stores the name a provider gives a source, such as a Zotero group's or an
 * OpenScholar collection's, so the admin sees it instead of the provider and
 * scope id. The name is cosmetic, so a failure never blocks the sync.
 */
export async function saveSourceDisplayName(
	database: Database,
	connection: { displayName: string | null; key: string },
	readName: () => Promise<string | null | undefined>,
) {
	try {
		const name = (await readName())?.trim().slice(0, 255);
		if (!name || name === connection.displayName) return;
		await database
			.update(sourceConnection)
			.set({ displayName: name, updatedAt: new Date() })
			.where(eq(sourceConnection.key, connection.key));
	} catch (error) {
		console.warn(`Could not save the name of source ${connection.key}:`, error instanceof Error ? error.message : error);
	}
}
