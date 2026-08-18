import {
	adoptableCanonicalRecordKey,
	collectionIdentity,
	generateCanonicalRecordKey,
	itemIdentity,
	itemSourceLink,
	reserveCanonicalRecordKey,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "./database-schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

type ReserveIdentityOptions = {
	sourceConnectionKey: string;
	sourceRecordKey?: string;
};

type IdentityTable = typeof itemIdentity | typeof collectionIdentity;

const MAX_IDENTITY_ALLOCATION_ATTEMPTS = 100;

async function reserveRecordIdentities(
	db: Executor,
	table: IdentityTable,
	{
		sourceConnectionKey,
		sourceRecordKeys,
	}: {
		sourceConnectionKey: string;
		sourceRecordKeys: string[];
	},
) {
	const uniqueSourceRecordKeys = [...new Set(sourceRecordKeys)];
	if (uniqueSourceRecordKeys.length !== sourceRecordKeys.length) {
		throw new Error("Source record keys must be unique within a batch");
	}
	if (uniqueSourceRecordKeys.length === 0) {
		return new Map<string, string>();
	}

	const result = new Map<string, string>();
	const loadExisting = async (keys: string[]) => {
		if (keys.length === 0) return;
		const rows = await db
			.select({
				key: table.key,
				sourceRecordKey: table.sourceRecordKey,
			})
			.from(table)
			.where(
				and(
					eq(table.sourceConnectionKey, sourceConnectionKey),
					inArray(table.sourceRecordKey, keys),
				),
			);
		for (const row of rows) {
			result.set(row.sourceRecordKey, row.key);
		}
	};

	await loadExisting(uniqueSourceRecordKeys);
	let pending = uniqueSourceRecordKeys.filter((key) => !result.has(key));

	const adoptableRows = pending.flatMap((sourceRecordKey) => {
		const key = adoptableCanonicalRecordKey(sourceRecordKey);
		return key ? [{ key, sourceConnectionKey, sourceRecordKey }] : [];
	});
	if (adoptableRows.length > 0) {
		const adopted = await db
			.insert(table)
			.values(adoptableRows)
			.onConflictDoNothing()
			.returning({
				key: table.key,
				sourceRecordKey: table.sourceRecordKey,
			});
		for (const row of adopted) {
			result.set(row.sourceRecordKey, row.key);
		}
	}

	await loadExisting(pending);
	pending = pending.filter((key) => !result.has(key));

	for (
		let attempt = 0;
		pending.length > 0 && attempt < MAX_IDENTITY_ALLOCATION_ATTEMPTS;
		attempt += 1
	) {
		const candidates = pending.map((sourceRecordKey) => ({
			key: generateCanonicalRecordKey(),
			sourceConnectionKey,
			sourceRecordKey,
		}));
		const inserted = await db
			.insert(table)
			.values(candidates)
			.onConflictDoNothing()
			.returning({
				key: table.key,
				sourceRecordKey: table.sourceRecordKey,
			});
		for (const row of inserted) {
			result.set(row.sourceRecordKey, row.key);
		}

		await loadExisting(pending);
		pending = pending.filter((key) => !result.has(key));
	}

	if (pending.length > 0) {
		throw new Error(
			`Failed to reserve canonical identities for: ${pending.join(", ")}`,
		);
	}
	return result;
}

export async function reserveItemIdentities(
	db: Executor,
	options: {
		sourceConnectionKey: string;
		sourceRecordKeys: string[];
	},
) {
	return reserveRecordIdentities(db, itemIdentity, options);
}

export async function reserveItemSourceLinks(
	db: Executor,
	{
		sourceConnectionKey,
		sourceRecordKeys,
	}: {
		sourceConnectionKey: string;
		sourceRecordKeys: string[];
	},
) {
	const uniqueSourceRecordKeys = [...new Set(sourceRecordKeys)];
	if (uniqueSourceRecordKeys.length !== sourceRecordKeys.length) {
		throw new Error("Source record keys must be unique within a batch");
	}
	if (uniqueSourceRecordKeys.length === 0) {
		return new Map<string, string>();
	}

	const result = new Map<string, string>();
	const loadLinks = async () => {
		const rows = await db
			.select({
				itemKey: itemSourceLink.itemKey,
				sourceRecordKey: itemSourceLink.sourceRecordKey,
			})
			.from(itemSourceLink)
			.where(
				and(
					eq(itemSourceLink.sourceConnectionKey, sourceConnectionKey),
					inArray(
						itemSourceLink.sourceRecordKey,
						uniqueSourceRecordKeys,
					),
				),
			);
		for (const row of rows) {
			result.set(row.sourceRecordKey, row.itemKey);
		}
	};

	await loadLinks();
	const pending = uniqueSourceRecordKeys.filter((key) => !result.has(key));
	if (pending.length > 0) {
		const allocated = await reserveRecordIdentities(db, itemIdentity, {
			sourceConnectionKey,
			sourceRecordKeys: pending,
		});
		await db
			.insert(itemSourceLink)
			.values(
				pending.map((sourceRecordKey) => ({
					itemKey: allocated.get(sourceRecordKey)!,
					sourceConnectionKey,
					sourceRecordKey,
				})),
			)
			.onConflictDoNothing();
		await loadLinks();

		const insertedItemKeys = pending.flatMap((sourceRecordKey) => {
			const itemKey = result.get(sourceRecordKey);
			return itemKey ? [itemKey] : [];
		});
		// A record imported from a source writes back to that source by
		// default, but only when the record has no enabled source yet. A
		// record the admin already directs elsewhere keeps that choice.
		if (insertedItemKeys.length > 0) {
			const enabledLink = alias(itemSourceLink, "enabledItemSourceLink");
			await db
				.update(itemSourceLink)
				.set({ writebackEnabled: true })
				.where(
					and(
						inArray(itemSourceLink.itemKey, insertedItemKeys),
						eq(
							itemSourceLink.sourceConnectionKey,
							sourceConnectionKey,
						),
						notExists(
							db
								.select({ itemKey: enabledLink.itemKey })
								.from(enabledLink)
								.where(
									and(
										eq(enabledLink.itemKey, itemSourceLink.itemKey),
										eq(enabledLink.writebackEnabled, true),
									),
								),
						),
					),
				);
		}
	}

	const unresolved = uniqueSourceRecordKeys.filter((key) => !result.has(key));
	if (unresolved.length > 0) {
		throw new Error(
			`Failed to reserve source links for: ${unresolved.join(", ")}`,
		);
	}
	return result;
}

export async function reserveCollectionIdentities(
	db: Executor,
	options: {
		sourceConnectionKey: string;
		sourceRecordKeys: string[];
	},
) {
	return reserveRecordIdentities(db, collectionIdentity, options);
}

export async function reserveItemIdentity(
	db: Executor,
	{ sourceConnectionKey, sourceRecordKey }: ReserveIdentityOptions,
) {
	return reserveCanonicalRecordKey({
		sourceRecordKey,
		findExistingKey: async () => {
			if (!sourceRecordKey) return null;
			const [existing] = await db
				.select({ key: itemIdentity.key })
				.from(itemIdentity)
				.where(
					and(
						eq(
							itemIdentity.sourceConnectionKey,
							sourceConnectionKey,
						),
						eq(itemIdentity.sourceRecordKey, sourceRecordKey),
					),
				)
				.limit(1);
			return existing?.key ?? null;
		},
		tryReserveKey: async (candidate) => {
			const [inserted] = await db
				.insert(itemIdentity)
				.values({
					key: candidate,
					sourceConnectionKey,
					sourceRecordKey: sourceRecordKey ?? candidate,
				})
				.onConflictDoNothing()
				.returning({ key: itemIdentity.key });
			return inserted !== undefined;
		},
	});
}

export async function reserveCollectionIdentity(
	db: Executor,
	{ sourceConnectionKey, sourceRecordKey }: ReserveIdentityOptions,
) {
	return reserveCanonicalRecordKey({
		sourceRecordKey,
		findExistingKey: async () => {
			if (!sourceRecordKey) return null;
			const [existing] = await db
				.select({ key: collectionIdentity.key })
				.from(collectionIdentity)
				.where(
					and(
						eq(
							collectionIdentity.sourceConnectionKey,
							sourceConnectionKey,
						),
						eq(collectionIdentity.sourceRecordKey, sourceRecordKey),
					),
				)
				.limit(1);
			return existing?.key ?? null;
		},
		tryReserveKey: async (candidate) => {
			const [inserted] = await db
				.insert(collectionIdentity)
				.values({
					key: candidate,
					sourceConnectionKey,
					sourceRecordKey: sourceRecordKey ?? candidate,
				})
				.onConflictDoNothing()
				.returning({ key: collectionIdentity.key });
			return inserted !== undefined;
		},
	});
}
