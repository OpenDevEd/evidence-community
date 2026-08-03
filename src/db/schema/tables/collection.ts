import {
	canonicalRecordKeyCheck,
	collectionIdentity,
	sourceIdentityColumns,
} from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	timestamp,
	unique,
	varchar,
} from "drizzle-orm/pg-core";

export const collection = pgTable(
	"collection",
	{
		key: varchar("key", { length: 8 }).primaryKey(),
		...sourceIdentityColumns(),

		revision: bigint("revision", { mode: "number" }).notNull().default(1),
		numCollections: integer("numCollections").default(0),
		numItems: integer("numItems").default(0),
		name: varchar("name"),
		deleted: integer("deleted").default(0),
		deletedAt: timestamp("deletedAt", { withTimezone: true }),
		sortOrder: integer("sortOrder"),

		parentCollection: varchar("parentCollection", { length: 8 }),

		relations: jsonb(),

		createdAt: timestamp("createdAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updatedAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		canonicalRecordKeyCheck("collection_key_format", table.key),
		unique("collection_key_source_connection_unique").on(
			table.key,
			table.sourceConnectionKey,
		),
		foreignKey({
			name: "collection_identity_fk",
			columns: [
				table.key,
				table.sourceConnectionKey,
				table.sourceRecordKey,
			],
			foreignColumns: [
				collectionIdentity.key,
				collectionIdentity.sourceConnectionKey,
				collectionIdentity.sourceRecordKey,
			],
		}),
		foreignKey({
			name: "collection_parent_source_fk",
			columns: [table.parentCollection, table.sourceConnectionKey],
			foreignColumns: [table.key, table.sourceConnectionKey],
		}),
		check(
			"collection_native_sort_order_required",
			sql`${table.sourceConnectionKey} <> 'native' OR ${table.sortOrder} IS NOT NULL`,
		),
		index("collection_source_connection_idx").on(table.sourceConnectionKey),
		index("collection_parent_idx").on(table.parentCollection),
		index("collection_tree_order_idx").on(
			table.sourceConnectionKey,
			table.parentCollection,
			table.sortOrder,
			table.key,
		),
	],
);
