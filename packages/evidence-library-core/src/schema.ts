import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import {
	CANONICAL_RECORD_KEY_SQL_PATTERN,
	SOURCE_CONNECTION_KEY_SQL_PATTERN,
} from "./identity.js";

export const SOURCE_PROVIDERS = [
	"native",
	"zotero",
	"mendeley",
	"openalex",
	"dspace",
	"eprints",
] as const;

export const SOURCE_SCOPE_KINDS = [
	"library",
	"group",
	"personal-library",
	"query",
	"repository",
	"collection",
	"oai-set",
] as const;

export const SOURCE_CONNECTION_STATUSES = [
	"active",
	"paused",
	"removed",
] as const;

export const OUTBOX_ENTITY_TYPES = ["item", "collection"] as const;
export const OUTBOX_OPERATIONS = ["upsert", "delete"] as const;

export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];
export type SourceScopeKind = (typeof SOURCE_SCOPE_KINDS)[number];
export type SourceConnectionStatus =
	(typeof SOURCE_CONNECTION_STATUSES)[number];
export type OutboxEntityType = (typeof OUTBOX_ENTITY_TYPES)[number];
export type OutboxOperation = (typeof OUTBOX_OPERATIONS)[number];

type JsonObject = Record<string, unknown>;

const timestampWithTimezone = (name: string) =>
	timestamp(name, { withTimezone: true });

export function canonicalRecordKeyCheck(
	name: string,
	column: AnyPgColumn,
) {
	return check(
		name,
		sql`${column} ~ ${sql.raw(`'${CANONICAL_RECORD_KEY_SQL_PATTERN}'`)}`,
	);
}

export const sourceConnection = pgTable(
	"sourceConnection",
	{
		key: varchar("key", { length: 64 }).primaryKey(),
		provider: text("provider", { enum: SOURCE_PROVIDERS }).notNull(),
		scopeKind: text("scopeKind", { enum: SOURCE_SCOPE_KINDS }).notNull(),
		externalScopeKey: varchar("externalScopeKey", { length: 512 }),
		credentialRef: varchar("credentialRef", { length: 255 }),
		config: jsonb("config").$type<JsonObject>().notNull().default({}),
		syncCursor: jsonb("syncCursor")
			.$type<JsonObject>()
			.notNull()
			.default({}),
		status: text("status", { enum: SOURCE_CONNECTION_STATUSES })
			.notNull()
			.default("active"),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		check(
			"sourceConnection_key_format",
			sql`${table.key} ~ ${sql.raw(`'${SOURCE_CONNECTION_KEY_SQL_PATTERN}'`)}`,
		),
		check(
			"sourceConnection_scope_valid",
			sql`(
				(${table.provider} = 'native' AND ${table.key} = 'native' AND ${table.scopeKind} = 'library' AND ${table.externalScopeKey} IS NULL)
				OR (${table.provider} = 'zotero' AND ${table.scopeKind} IN ('group', 'personal-library') AND ${table.externalScopeKey} IS NOT NULL)
				OR (${table.provider} = 'mendeley' AND ${table.scopeKind} IN ('group', 'personal-library') AND ${table.externalScopeKey} IS NOT NULL)
				OR (${table.provider} = 'openalex' AND ${table.scopeKind} = 'query' AND ${table.externalScopeKey} IS NULL)
				OR (${table.provider} = 'dspace' AND ${table.scopeKind} IN ('repository', 'collection', 'oai-set') AND ${table.externalScopeKey} IS NOT NULL)
				OR (${table.provider} = 'eprints' AND ${table.scopeKind} IN ('repository', 'oai-set') AND ${table.externalScopeKey} IS NOT NULL)
			)`,
		),
		check(
			"sourceConnection_status_valid",
			sql`${table.status} IN ('active', 'paused', 'removed')`,
		),
		uniqueIndex("sourceConnection_provider_scope_unique")
			.on(table.provider, table.externalScopeKey)
			.where(sql`${table.externalScopeKey} IS NOT NULL`),
		index("sourceConnection_status_idx").on(table.status),
	],
);

export function sourceIdentityColumns() {
	return {
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.references(() => sourceConnection.key, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		sourceRecordKey: varchar("sourceRecordKey", { length: 512 }).notNull(),
	};
}

function createRecordIdentityTable(
	tableName: "itemIdentity" | "collectionIdentity",
) {
	return pgTable(
		tableName,
		{
			key: varchar("key", { length: 8 }).primaryKey(),
			...sourceIdentityColumns(),
			createdAt: timestampWithTimezone("createdAt")
				.notNull()
				.defaultNow(),
		},
		(table) => [
			canonicalRecordKeyCheck(`${tableName}_key_format`, table.key),
			check(
				`${tableName}_native_source_key_match`,
				sql`${table.sourceConnectionKey} <> 'native' OR ${table.sourceRecordKey} = ${table.key}`,
			),
			unique(`${tableName}_source_record_unique`).on(
				table.sourceConnectionKey,
				table.sourceRecordKey,
			),
			unique(`${tableName}_identity_unique`).on(
				table.key,
				table.sourceConnectionKey,
				table.sourceRecordKey,
			),
			unique(`${tableName}_key_connection_unique`).on(
				table.key,
				table.sourceConnectionKey,
			),
		],
	);
}

export const itemIdentity = createRecordIdentityTable("itemIdentity");
export const collectionIdentity = createRecordIdentityTable(
	"collectionIdentity",
);

export const itemDraft = pgTable(
	"itemDraft",
	{
		itemKey: varchar("itemKey", { length: 8 }).primaryKey(),
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.default("native"),
		payload: jsonb("payload").$type<JsonObject>().notNull(),
		baseRevision: bigint("baseRevision", { mode: "number" })
			.notNull()
			.default(0),
		draftRevision: bigint("draftRevision", { mode: "number" })
			.notNull()
			.default(1),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		check(
			"itemDraft_native_only",
			sql`${table.sourceConnectionKey} = 'native'`,
		),
		check(
			"itemDraft_payload_object",
			sql`jsonb_typeof(${table.payload}) = 'object'`,
		),
		check(
			"itemDraft_revision_positive",
			sql`${table.draftRevision} >= 1 AND ${table.baseRevision} >= 0`,
		),
		foreignKey({
			name: "itemDraft_identity_fk",
			columns: [table.itemKey, table.sourceConnectionKey],
			foreignColumns: [
				itemIdentity.key,
				itemIdentity.sourceConnectionKey,
			],
		}).onDelete("cascade"),
	],
);

export const itemFileDraft = pgTable(
	"itemFileDraft",
	{
		itemKey: varchar("itemKey", { length: 8 }).primaryKey(),
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.default("native"),
		parentItemKey: varchar("parentItemKey", { length: 8 }).notNull(),
		uploadRevision: bigint("uploadRevision", { mode: "number" })
			.notNull()
			.default(1),
		objectPath: varchar("objectPath", { length: 1024 }).notNull(),
		filename: varchar("filename", { length: 255 }).notNull(),
		contentType: varchar("contentType", { length: 128 }).notNull(),
		expectedSizeBytes: bigint("expectedSizeBytes", {
			mode: "number",
		}).notNull(),
		expectedSha256: varchar("expectedSha256", { length: 64 }).notNull(),
		actualSizeBytes: bigint("actualSizeBytes", { mode: "number" }),
		actualSha256: varchar("actualSha256", { length: 64 }),
		extractedText: text("extractedText"),
		coverObjectPath: varchar("coverObjectPath", { length: 1024 }),
		coverWidth: integer("coverWidth"),
		coverHeight: integer("coverHeight"),
		pageCount: integer("pageCount"),
		readyAt: timestampWithTimezone("readyAt"),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		check(
			"itemFileDraft_native_only",
			sql`${table.sourceConnectionKey} = 'native'`,
		),
		check(
			"itemFileDraft_pdf_only",
			sql`${table.contentType} = 'application/pdf'`,
		),
		check(
			"itemFileDraft_filename_valid",
			sql`length(btrim(${table.filename})) BETWEEN 1 AND 255`,
		),
		check(
			"itemFileDraft_expected_size_positive",
			sql`${table.expectedSizeBytes} > 0`,
		),
		check(
			"itemFileDraft_expected_sha256_valid",
			sql`${table.expectedSha256} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"itemFileDraft_upload_revision_positive",
			sql`${table.uploadRevision} >= 1`,
		),
		check(
			"itemFileDraft_ready_bundle_consistent",
			sql`(
				(
					${table.readyAt} IS NULL
					AND ${table.actualSizeBytes} IS NULL
					AND ${table.actualSha256} IS NULL
					AND ${table.extractedText} IS NULL
					AND ${table.coverObjectPath} IS NULL
					AND ${table.coverWidth} IS NULL
					AND ${table.coverHeight} IS NULL
					AND ${table.pageCount} IS NULL
				)
				OR (
					${table.readyAt} IS NOT NULL
					AND ${table.actualSizeBytes} = ${table.expectedSizeBytes}
					AND ${table.actualSha256} = ${table.expectedSha256}
					AND ${table.extractedText} IS NOT NULL
					AND ${table.coverObjectPath} IS NOT NULL
					AND ${table.coverWidth} > 0
					AND ${table.coverHeight} > 0
					AND ${table.pageCount} > 0
				)
			)`,
		),
		foreignKey({
			name: "itemFileDraft_item_identity_fk",
			columns: [table.itemKey, table.sourceConnectionKey],
			foreignColumns: [
				itemIdentity.key,
				itemIdentity.sourceConnectionKey,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "itemFileDraft_parent_identity_fk",
			columns: [table.parentItemKey, table.sourceConnectionKey],
			foreignColumns: [
				itemIdentity.key,
				itemIdentity.sourceConnectionKey,
			],
		}).onDelete("cascade"),
		unique("itemFileDraft_object_path_unique").on(table.objectPath),
		index("itemFileDraft_parent_idx").on(table.parentItemKey),
	],
);

export const outbox = pgTable(
	"outbox",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		entityType: text("entityType", { enum: OUTBOX_ENTITY_TYPES }).notNull(),
		entityKey: varchar("entityKey", { length: 8 }).notNull(),
		operation: text("operation", { enum: OUTBOX_OPERATIONS }).notNull(),
		revision: bigint("revision", { mode: "number" }).notNull(),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("lastError"),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		processedAt: timestampWithTimezone("processedAt"),
	},
	(table) => [
		check(
			"outbox_entity_type_valid",
			sql`${table.entityType} IN ('item', 'collection')`,
		),
		check(
			"outbox_operation_valid",
			sql`${table.operation} IN ('upsert', 'delete')`,
		),
		uniqueIndex("outbox_entity_revision_unique").on(
			table.entityType,
			table.entityKey,
			table.revision,
		),
		index("outbox_unprocessed_idx")
			.on(table.id)
			.where(sql`${table.processedAt} IS NULL`),
	],
);

export function createItemFilePublicationTable(itemColumns: {
	key: AnyPgColumn;
	sourceConnectionKey: AnyPgColumn;
}) {
	return pgTable(
		"itemFilePublication",
		{
			itemKey: varchar("itemKey", { length: 8 }).primaryKey(),
			sourceConnectionKey: varchar("sourceConnectionKey", {
				length: 64,
			}).notNull(),
			parentItemKey: varchar("parentItemKey", {
				length: 8,
			}).notNull(),
			uploadRevision: bigint("uploadRevision", {
				mode: "number",
			}).notNull(),
			revision: bigint("revision", { mode: "number" }).notNull(),
			sourceObjectPath: varchar("sourceObjectPath", {
				length: 1024,
			}).notNull(),
			sourceCoverObjectPath: varchar("sourceCoverObjectPath", {
				length: 1024,
			}).notNull(),
			objectPath: varchar("objectPath", { length: 1024 }).notNull(),
			publicUrl: varchar("publicUrl", { length: 2048 }).notNull(),
			filename: varchar("filename", { length: 255 }).notNull(),
			contentType: varchar("contentType", { length: 128 }).notNull(),
			sizeBytes: bigint("sizeBytes", { mode: "number" }).notNull(),
			sha256: varchar("sha256", { length: 64 }).notNull(),
			coverObjectPath: varchar("coverObjectPath", {
				length: 1024,
			}).notNull(),
			coverPublicUrl: varchar("coverPublicUrl", {
				length: 2048,
			}).notNull(),
			coverWidth: integer("coverWidth").notNull(),
			coverHeight: integer("coverHeight").notNull(),
			pageCount: integer("pageCount").notNull(),
			publishedAt: timestampWithTimezone("publishedAt").notNull(),
			createdAt: timestampWithTimezone("createdAt")
				.notNull()
				.defaultNow(),
			updatedAt: timestampWithTimezone("updatedAt")
				.notNull()
				.defaultNow(),
		},
		(table) => [
			check(
				"itemFilePublication_pdf_only",
				sql`${table.contentType} = 'application/pdf'`,
			),
			check(
				"itemFilePublication_revision_positive",
				sql`${table.revision} >= 1 AND ${table.uploadRevision} >= 1`,
			),
			check(
				"itemFilePublication_size_positive",
				sql`${table.sizeBytes} > 0`,
			),
			check(
				"itemFilePublication_sha256_valid",
				sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
			),
			check(
				"itemFilePublication_dimensions_positive",
				sql`${table.coverWidth} > 0 AND ${table.coverHeight} > 0 AND ${table.pageCount} > 0`,
			),
			foreignKey({
				name: "itemFilePublication_item_fk",
				columns: [table.itemKey, table.sourceConnectionKey],
				foreignColumns: [
					itemColumns.key,
					itemColumns.sourceConnectionKey,
				],
			}).onDelete("cascade"),
			foreignKey({
				name: "itemFilePublication_parent_fk",
				columns: [
					table.parentItemKey,
					table.sourceConnectionKey,
				],
				foreignColumns: [
					itemColumns.key,
					itemColumns.sourceConnectionKey,
				],
			}).onDelete("cascade"),
			unique("itemFilePublication_object_path_unique").on(
				table.objectPath,
			),
			index("itemFilePublication_parent_idx").on(
				table.parentItemKey,
			),
		],
	);
}

export function createSourceRecordTables(itemColumns: {
	key: AnyPgColumn;
	sourceConnectionKey: AnyPgColumn;
}) {
	const sourceSnapshot = pgTable(
		"sourceSnapshot",
		{
			itemKey: varchar("itemKey", { length: 8 })
				.notNull()
				.references(() => itemColumns.key, { onDelete: "cascade" }),
			payload: jsonb("payload").$type<JsonObject>().notNull(),
			remoteVersion: varchar("remoteVersion", { length: 255 }),
			payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
			mappingProfileVersion: varchar("mappingProfileVersion", {
				length: 64,
			}),
			fetchedAt: timestampWithTimezone("fetchedAt").notNull(),
		},
		(table) => [primaryKey({ columns: [table.itemKey] })],
	);

	const sourceRecordAlias = pgTable(
		"sourceRecordAlias",
		{
			sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
				.notNull()
				.references(() => sourceConnection.key, {
					onDelete: "restrict",
					onUpdate: "cascade",
				}),
			aliasKey: varchar("aliasKey", { length: 512 }).notNull(),
			itemKey: varchar("itemKey", { length: 8 }).notNull(),
			kind: varchar("kind", { length: 64 }).notNull(),
		},
		(table) => [
			primaryKey({
				columns: [table.sourceConnectionKey, table.aliasKey],
			}),
			foreignKey({
				name: "sourceRecordAlias_item_source_fk",
				columns: [table.itemKey, table.sourceConnectionKey],
				foreignColumns: [
					itemColumns.key,
					itemColumns.sourceConnectionKey,
				],
			}).onDelete("cascade"),
			index("sourceRecordAlias_item_idx").on(table.itemKey),
		],
	);

	return { sourceSnapshot, sourceRecordAlias };
}
