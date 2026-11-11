import {
	adoptableCanonicalRecordKey,
	collectionIdentity,
	generateCanonicalRecordKey,
	itemIdentity,
	itemSourceLink,
	sourceConnection,
	reserveCanonicalRecordKey,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "./database-schema";
import { isOpenAlexWorkProvider, OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

type ReserveIdentityOptions = {
	sourceConnectionKey: string;
	sourceRecordKey?: string;
};

type IdentityTable = typeof itemIdentity | typeof collectionIdentity;

const MAX_IDENTITY_ALLOCATION_ATTEMPTS = 100;

/** A batch's record keys; a batch that names a record twice is refused. */
function uniqueRecordKeys(sourceRecordKeys: string[]) {
	const unique = [...new Set(sourceRecordKeys)];
	if (unique.length !== sourceRecordKeys.length) {
		throw new Error("Source record keys must be unique within a batch");
	}
	return unique;
}

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
	const uniqueSourceRecordKeys = uniqueRecordKeys(sourceRecordKeys);
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

/**
 * This source's own record under a key is deleted, while another source of OpenAlex works holds a public record under
 * the same key: a paper this source let go of and then took back, such as a report its collection dropped and Added
 * papers added again meanwhile. This source joins the public record instead of bringing its own back, so one paper is
 * never two records.
 */
async function joinKeptRecords(db: Executor, sourceConnectionKey: string, sourceRecordKeys: readonly string[]) {
	const keys = sql`ARRAY[${sql.join(sourceRecordKeys.map((key) => sql`${key}`), sql`, `)}]::varchar[]`;
	const providers = sql`ARRAY[${sql.join(OPENALEX_WORK_PROVIDERS.map((provider) => sql`${provider}`), sql`, `)}]::text[]`;
	const moves = await db.execute<{ sourceRecordKey: string; kept: string }>(sql`
		SELECT DISTINCT ON (mine."sourceRecordKey") mine."sourceRecordKey", other."itemKey" AS kept
		FROM "itemSourceLink" mine
		JOIN "item" gone ON gone.key = mine."itemKey" AND gone.deleted = 1
		JOIN "itemSourceLink" other ON other."sourceRecordKey" = mine."sourceRecordKey" AND other."sourceConnectionKey" <> mine."sourceConnectionKey" AND NOT other."remoteDeleted"
		JOIN "sourceConnection" c ON c.key = other."sourceConnectionKey" AND c.status <> 'removed' AND c.provider = ANY(${providers})
		JOIN "item" kept ON kept.key = other."itemKey" AND kept.deleted = 0
		WHERE mine."sourceConnectionKey" = ${sourceConnectionKey} AND mine."sourceRecordKey" = ANY(${keys})
			AND NOT EXISTS (SELECT 1 FROM "itemSourceLink" taken WHERE taken."itemKey" = other."itemKey" AND taken."sourceConnectionKey" = ${sourceConnectionKey})
		ORDER BY mine."sourceRecordKey", other."itemKey"`);
	if (!moves.rows.length) return [];
	// The deleted record's copy from this source goes with its link (its snapshot cascades); the write that follows
	// gives the kept record this source's copy.
	await db.delete(itemSourceLink).where(and(eq(itemSourceLink.sourceConnectionKey, sourceConnectionKey), inArray(itemSourceLink.sourceRecordKey, moves.rows.map((row) => row.sourceRecordKey))));
	await db.insert(itemSourceLink).values(moves.rows.map((row) => ({ itemKey: row.kept, sourceConnectionKey, sourceRecordKey: row.sourceRecordKey }))).onConflictDoNothing();
	// Joined as a newly shared record is, so it is searched again with this source among its sources.
	return moves.rows.map((row) => row.kept);
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
	const uniqueSourceRecordKeys = uniqueRecordKeys(sourceRecordKeys);
	if (uniqueSourceRecordKeys.length === 0) {
		return { keys: new Map<string, string>(), joined: new Set<string>() };
	}

	const result = new Map<string, string>();
	// Records already here that this source now holds too: another OpenAlex source brought them first.
	const joined = new Set<string>();
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

	const [connection] = await db
		.select({ provider: sourceConnection.provider })
		.from(sourceConnection)
		.where(eq(sourceConnection.key, sourceConnectionKey));
	if (isOpenAlexWorkProvider(connection?.provider)) {
		// Sources of OpenAlex works share work identity inside this library, never DOI-match manual or Zotero records.
		const byIdentity = await db
			.select({ itemKey: itemIdentity.key, sourceRecordKey: itemIdentity.sourceRecordKey })
			.from(itemIdentity)
			.innerJoin(sourceConnection, eq(sourceConnection.key, itemIdentity.sourceConnectionKey))
			.where(and(
				inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS),
				inArray(itemIdentity.sourceRecordKey, uniqueSourceRecordKeys),
			));
		// A record first added by its DOI, which OpenAlex has since, holds the work through its link alone.
		const byLink = await db
			.select({ itemKey: itemSourceLink.itemKey, sourceRecordKey: itemSourceLink.sourceRecordKey })
			.from(itemSourceLink)
			.innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
			.where(and(
				inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS),
				ne(itemSourceLink.sourceConnectionKey, sourceConnectionKey),
				inArray(itemSourceLink.sourceRecordKey, uniqueSourceRecordKeys),
			));
		for (const itemKey of await joinKeptRecords(db, sourceConnectionKey, uniqueSourceRecordKeys)) joined.add(itemKey);
		const shared = [...new Map([...byLink, ...byIdentity].map((row) => [row.sourceRecordKey, row])).values()];
		if (shared.length) {
			const added = await db.insert(itemSourceLink)
				.values(shared.map((row) => ({ ...row, sourceConnectionKey })))
				.onConflictDoNothing()
				.returning({ itemKey: itemSourceLink.itemKey });
			for (const row of added) joined.add(row.itemKey);
		}
	}
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
		if (insertedItemKeys.length > 0 && !isOpenAlexWorkProvider(connection?.provider)) {
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
	return { keys: result, joined };
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
