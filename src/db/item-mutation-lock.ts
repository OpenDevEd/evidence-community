import { sql } from "drizzle-orm";

import type { Database } from "./database-schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const LOCK_CHUNK_SIZE = 1_000;

export async function lockItemMutations(
	transaction: Transaction,
	itemKeys: readonly string[],
) {
	const orderedKeys = [...new Set(itemKeys)].sort();
	for (
		let offset = 0;
		offset < orderedKeys.length;
		offset += LOCK_CHUNK_SIZE
	) {
		const keyRows = sql.join(
			orderedKeys
				.slice(offset, offset + LOCK_CHUNK_SIZE)
				.map((key) => sql`(${key})`),
			sql`, `,
		);
		await transaction.execute(sql`
			SELECT pg_advisory_xact_lock(
				hashtextextended('item:' || ordered."itemKey", 0)
			)
			FROM (VALUES ${keyRows}) AS ordered("itemKey")
			ORDER BY ordered."itemKey"
		`);
	}
}

export async function lockItemMutation(
	transaction: Transaction,
	itemKey: string,
) {
	await lockItemMutations(transaction, [itemKey]);
}
