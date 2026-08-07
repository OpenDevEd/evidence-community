import { sql } from "drizzle-orm";

import type { Database } from "./database-schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type CanonicalEntity = "collection" | "item";

const LOCK_CHUNK_SIZE = 1_000;

async function lockCanonicalMutations(
	transaction: Transaction,
	entity: CanonicalEntity,
	keys: readonly string[],
) {
	const orderedKeys = [...new Set(keys)].sort();
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
				hashtextextended(${entity} || ':' || ordered."key", 0)
			)
			FROM (VALUES ${keyRows}) AS ordered("key")
			ORDER BY ordered."key"
		`);
	}
}

export function lockItemMutations(
	transaction: Transaction,
	itemKeys: readonly string[],
) {
	return lockCanonicalMutations(transaction, "item", itemKeys);
}

export function lockItemMutation(transaction: Transaction, itemKey: string) {
	return lockItemMutations(transaction, [itemKey]);
}

export function lockCollectionMutations(
	transaction: Transaction,
	collectionKeys: readonly string[],
) {
	return lockCanonicalMutations(transaction, "collection", collectionKeys);
}

export function lockCollectionMutation(
	transaction: Transaction,
	collectionKey: string,
) {
	return lockCollectionMutations(transaction, [collectionKey]);
}
