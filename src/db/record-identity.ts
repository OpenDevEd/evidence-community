import {
	collectionIdentity,
	itemIdentity,
	reserveCanonicalRecordKey,
} from "@opendeved/evidence-library-core";
import { and, eq } from "drizzle-orm";

import type { Database } from "./database-schema";

type Transaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
type Executor = Database | Transaction;

type ReserveIdentityOptions = {
	sourceConnectionKey: string;
	sourceRecordKey?: string;
};

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
	if (!sourceRecordKey) {
		throw new Error("Collections require a provider source record key");
	}

	return reserveCanonicalRecordKey({
		sourceRecordKey,
		findExistingKey: async () => {
			const [existing] = await db
				.select({ key: collectionIdentity.key })
				.from(collectionIdentity)
				.where(
					and(
						eq(
							collectionIdentity.sourceConnectionKey,
							sourceConnectionKey,
						),
						eq(
							collectionIdentity.sourceRecordKey,
							sourceRecordKey,
						),
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
					sourceRecordKey,
				})
				.onConflictDoNothing()
				.returning({ key: collectionIdentity.key });
			return inserted !== undefined;
		},
	});
}
