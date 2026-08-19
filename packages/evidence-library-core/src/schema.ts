import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
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

export const SOURCE_SYNC_RUN_STATUSES = [
	"running",
	"succeeded",
	"failed",
] as const;

export const OUTBOX_ENTITY_TYPES = ["item", "collection"] as const;
export const OUTBOX_OPERATIONS = ["upsert", "delete"] as const;
export const SOURCE_WRITEBACK_OPERATIONS = ["upsert", "delete"] as const;
export const SEARCH_INDEX_WORKER_STAGES = [
	"starting",
	"idle",
	"projecting",
	"waiting",
	"indexing",
	"retrying",
	"stopping",
	"stopped",
] as const;

export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];
export type SourceScopeKind = (typeof SOURCE_SCOPE_KINDS)[number];
export type SourceConnectionStatus =
	(typeof SOURCE_CONNECTION_STATUSES)[number];
export type SourceSyncRunStatus = (typeof SOURCE_SYNC_RUN_STATUSES)[number];
export type OutboxEntityType = (typeof OUTBOX_ENTITY_TYPES)[number];
export type OutboxOperation = (typeof OUTBOX_OPERATIONS)[number];
export type SourceWritebackOperation =
	(typeof SOURCE_WRITEBACK_OPERATIONS)[number];
export type SearchIndexWorkerStage =
	(typeof SEARCH_INDEX_WORKER_STAGES)[number];

type JsonObject = Record<string, unknown>;

const timestampWithTimezone = (name: string) =>
	timestamp(name, { withTimezone: true });

export function canonicalRecordKeyCheck(name: string, column: AnyPgColumn) {
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
		// The source's own name for this library (for example the Zotero group
		// name), read from the provider by the sync worker. Shown instead of
		// the provider and scope id wherever sources are listed.
		displayName: varchar("displayName", { length: 255 }),
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

export const sourceFileCleanup = pgTable(
	"sourceFileCleanup",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.references(() => sourceConnection.key, {
				onDelete: "cascade",
				onUpdate: "cascade",
			}),
		objectPath: varchar("objectPath", { length: 1024 }).notNull(),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("lastError"),
		deadLetteredAt: timestampWithTimezone("deadLetteredAt"),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		check(
			"sourceFileCleanup_attempts_nonnegative",
			sql`${table.attempts} >= 0`,
		),
		unique("sourceFileCleanup_connection_path_unique").on(
			table.sourceConnectionKey,
			table.objectPath,
		),
		index("sourceFileCleanup_connection_created_idx")
			.on(table.sourceConnectionKey, table.createdAt)
			.where(sql`${table.deadLetteredAt} IS NULL`),
	],
);

export const sourceRecordIssue = pgTable(
	"sourceRecordIssue",
	{
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.references(() => sourceConnection.key, {
				onDelete: "cascade",
				onUpdate: "cascade",
			}),
		sourceRecordKey: varchar("sourceRecordKey", { length: 512 }).notNull(),
		code: varchar("code", { length: 64 }).notNull(),
		message: varchar("message", { length: 4096 }).notNull(),
		remoteVersion: varchar("remoteVersion", { length: 255 }),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({
			columns: [table.sourceConnectionKey, table.sourceRecordKey],
		}),
		index("sourceRecordIssue_connection_updated_idx").on(
			table.sourceConnectionKey,
			table.updatedAt,
		),
	],
);

export const sourceSyncRun = pgTable(
	"sourceSyncRun",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.references(() => sourceConnection.key, {
				onDelete: "cascade",
				onUpdate: "cascade",
			}),
		workerId: varchar("workerId", { length: 255 }).notNull(),
		status: text("status", {
			enum: SOURCE_SYNC_RUN_STATUSES,
		})
			.notNull()
			.default("running"),
		startedAt: timestampWithTimezone("startedAt").notNull().defaultNow(),
		heartbeatAt: timestampWithTimezone("heartbeatAt")
			.notNull()
			.defaultNow(),
		finishedAt: timestampWithTimezone("finishedAt"),
		result: jsonb("result").$type<JsonObject>(),
		error: text("error"),
	},
	(table) => [
		check(
			"sourceSyncRun_status_valid",
			sql`${table.status} IN ('running', 'succeeded', 'failed')`,
		),
		check(
			"sourceSyncRun_terminal_state_valid",
			sql`(
				(${table.status} = 'running' AND ${table.finishedAt} IS NULL AND ${table.result} IS NULL AND ${table.error} IS NULL)
				OR (${table.status} = 'succeeded' AND ${table.finishedAt} IS NOT NULL AND ${table.result} IS NOT NULL AND ${table.error} IS NULL)
				OR (${table.status} = 'failed' AND ${table.finishedAt} IS NOT NULL AND ${table.result} IS NULL AND ${table.error} IS NOT NULL)
			)`,
		),
		uniqueIndex("sourceSyncRun_one_running_per_connection")
			.on(table.sourceConnectionKey)
			.where(sql`${table.status} = 'running'`),
		index("sourceSyncRun_connection_started_idx").on(
			table.sourceConnectionKey,
			table.startedAt,
		),
	],
);

export const sourceSyncState = pgTable(
	"sourceSyncState",
	{
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.primaryKey()
			.references(() => sourceConnection.key, {
				onDelete: "cascade",
				onUpdate: "cascade",
			}),
		activeRunId: bigint("activeRunId", { mode: "number" }).references(
			() => sourceSyncRun.id,
			{ onDelete: "set null" },
		),
		leaseOwner: varchar("leaseOwner", { length: 255 }),
		leaseExpiresAt: timestampWithTimezone("leaseExpiresAt"),
		lastAttemptAt: timestampWithTimezone("lastAttemptAt"),
		lastSuccessAt: timestampWithTimezone("lastSuccessAt"),
		lastFailureAt: timestampWithTimezone("lastFailureAt"),
		consecutiveFailures: integer("consecutiveFailures")
			.notNull()
			.default(0),
		lastError: text("lastError"),
		lastResult: jsonb("lastResult").$type<JsonObject>(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		check(
			"sourceSyncState_lease_bundle_valid",
			sql`(
				(${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.activeRunId} IS NULL)
				OR (${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL AND ${table.activeRunId} IS NOT NULL)
			)`,
		),
		check(
			"sourceSyncState_failures_nonnegative",
			sql`${table.consecutiveFailures} >= 0`,
		),
		uniqueIndex("sourceSyncState_active_run_unique")
			.on(table.activeRunId)
			.where(sql`${table.activeRunId} IS NOT NULL`),
		index("sourceSyncState_lease_expiry_idx")
			.on(table.leaseExpiresAt)
			.where(sql`${table.leaseOwner} IS NOT NULL`),
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
export const collectionIdentity =
	createRecordIdentityTable("collectionIdentity");

export const itemSourceLink = pgTable(
	"itemSourceLink",
	{
		itemKey: varchar("itemKey", { length: 8 })
			.notNull()
			.references(() => itemIdentity.key, { onDelete: "cascade" }),
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.references(() => sourceConnection.key, {
				onDelete: "cascade",
				onUpdate: "cascade",
			}),
		sourceRecordKey: varchar("sourceRecordKey", { length: 512 }).notNull(),
		remoteVersion: varchar("remoteVersion", { length: 255 }),
		remoteDeleted: boolean("remoteDeleted").notNull().default(false),
		lastAcknowledgedRemoteVersion: varchar(
			"lastAcknowledgedRemoteVersion",
			{ length: 255 },
		),
		dirtyFields: jsonb("dirtyFields")
			.$type<string[]>()
			.notNull()
			.default([]),
		writebackEnabled: boolean("writebackEnabled").notNull().default(false),
		// Set to the moment the admin re-enables a source that already has a
		// remote copy. The worker compares versions before it sends anything,
		// and its answer only counts for this exact request: a newer untick or
		// re-tick moves the timestamp and makes an older check stale.
		// The source's version when it was found to have changed while this
		// link was paused. Non-null means "conflict": nothing is sent until the
		// admin chooses which side wins.
		remoteCheckRequestedAt: timestampWithTimezone("remoteCheckRequestedAt"),
		conflictRemoteVersion: varchar("conflictRemoteVersion", { length: 255 }),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({
			columns: [table.itemKey, table.sourceConnectionKey],
		}),
		check(
			"itemSourceLink_remote_only",
			sql`${table.sourceConnectionKey} <> 'native'`,
		),
		check(
			"itemSourceLink_dirty_fields_array",
			sql`jsonb_typeof(${table.dirtyFields}) = 'array'`,
		),
		unique("itemSourceLink_source_record_unique").on(
			table.sourceConnectionKey,
			table.sourceRecordKey,
		),
		index("itemSourceLink_connection_idx").on(table.sourceConnectionKey),
	],
);

export const collectionSourceLink = pgTable(
	"collectionSourceLink",
	{
		collectionKey: varchar("collectionKey", { length: 8 })
			.notNull()
			.references(() => collectionIdentity.key, { onDelete: "cascade" }),
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.references(() => sourceConnection.key, {
				onDelete: "cascade",
				onUpdate: "cascade",
			}),
		sourceRecordKey: varchar("sourceRecordKey", { length: 512 }).notNull(),
		remoteVersion: varchar("remoteVersion", { length: 255 }),
		remoteDeleted: boolean("remoteDeleted").notNull().default(false),
		lastAcknowledgedRemoteVersion: varchar(
			"lastAcknowledgedRemoteVersion",
			{ length: 255 },
		),
		dirtyFields: jsonb("dirtyFields")
			.$type<string[]>()
			.notNull()
			.default([]),
		writebackEnabled: boolean("writebackEnabled").notNull().default(false),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({
			columns: [table.collectionKey, table.sourceConnectionKey],
		}),
		check(
			"collectionSourceLink_remote_only",
			sql`${table.sourceConnectionKey} <> 'native'`,
		),
		check(
			"collectionSourceLink_dirty_fields_array",
			sql`jsonb_typeof(${table.dirtyFields}) = 'array'`,
		),
		unique("collectionSourceLink_source_record_unique").on(
			table.sourceConnectionKey,
			table.sourceRecordKey,
		),
		uniqueIndex("collectionSourceLink_one_writeback_per_collection")
			.on(table.collectionKey)
			.where(sql`${table.writebackEnabled} = true`),
		index("collectionSourceLink_connection_idx").on(
			table.sourceConnectionKey,
		),
	],
);

export const collectionSourceSnapshot = pgTable(
	"collectionSourceSnapshot",
	{
		collectionKey: varchar("collectionKey", { length: 8 }).notNull(),
		sourceConnectionKey: varchar("sourceConnectionKey", {
			length: 64,
		}).notNull(),
		payload: jsonb("payload").$type<JsonObject>().notNull(),
		remoteVersion: varchar("remoteVersion", { length: 255 }),
		payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
		mappingProfileVersion: varchar("mappingProfileVersion", {
			length: 64,
		}),
		fetchedAt: timestampWithTimezone("fetchedAt").notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.collectionKey, table.sourceConnectionKey],
		}),
		foreignKey({
			name: "collectionSourceSnapshot_collection_source_link_fk",
			columns: [table.collectionKey, table.sourceConnectionKey],
			foreignColumns: [
				collectionSourceLink.collectionKey,
				collectionSourceLink.sourceConnectionKey,
			],
		}).onDelete("cascade"),
	],
);

export const sourceWritebackJob = pgTable(
	"sourceWritebackJob",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		itemKey: varchar("itemKey", { length: 8 }),
		collectionKey: varchar("collectionKey", { length: 8 }),
		sourceConnectionKey: varchar("sourceConnectionKey", {
			length: 64,
		}).notNull(),
		operation: text("operation", {
			enum: SOURCE_WRITEBACK_OPERATIONS,
		}).notNull(),
		canonicalRevision: bigint("canonicalRevision", {
			mode: "number",
		}).notNull(),
		dirtyFields: jsonb("dirtyFields")
			.$type<string[]>()
			.notNull()
			.default([]),
		idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("lastError"),
		nextAttemptAt: timestampWithTimezone("nextAttemptAt")
			.notNull()
			.defaultNow(),
		leaseOwner: varchar("leaseOwner", { length: 255 }),
		leaseExpiresAt: timestampWithTimezone("leaseExpiresAt"),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		processedAt: timestampWithTimezone("processedAt"),
		deadLetteredAt: timestampWithTimezone("deadLetteredAt"),
		superseded: boolean("superseded").notNull().default(false),
		completedSourceRecordKey: varchar("completedSourceRecordKey", {
			length: 512,
		}),
		completedRemoteVersion: varchar("completedRemoteVersion", {
			length: 255,
		}),
	},
	(table) => [
		foreignKey({
			name: "sourceWritebackJob_item_link_fk",
			columns: [table.itemKey, table.sourceConnectionKey],
			foreignColumns: [
				itemSourceLink.itemKey,
				itemSourceLink.sourceConnectionKey,
			],
		})
			.onDelete("cascade")
			.onUpdate("cascade"),
		foreignKey({
			name: "sourceWritebackJob_collection_link_fk",
			columns: [table.collectionKey, table.sourceConnectionKey],
			foreignColumns: [
				collectionSourceLink.collectionKey,
				collectionSourceLink.sourceConnectionKey,
			],
		})
			.onDelete("cascade")
			.onUpdate("cascade"),
		check(
			"sourceWritebackJob_one_entity",
			sql`(${table.itemKey} IS NULL) <> (${table.collectionKey} IS NULL)`,
		),
		check(
			"sourceWritebackJob_operation_valid",
			sql`${table.operation} IN ('upsert', 'delete')`,
		),
		check(
			"sourceWritebackJob_revision_positive",
			sql`${table.canonicalRevision} >= 1`,
		),
		check(
			"sourceWritebackJob_dirty_fields_array",
			sql`jsonb_typeof(${table.dirtyFields}) = 'array'`,
		),
		check(
			"sourceWritebackJob_attempts_nonnegative",
			sql`${table.attempts} >= 0`,
		),
		check(
			"sourceWritebackJob_lease_bundle_valid",
			sql`(
				(${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL)
				OR (${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)
			)`,
		),
		check(
			"sourceWritebackJob_terminal_state_valid",
			sql`NOT (${table.processedAt} IS NOT NULL AND ${table.deadLetteredAt} IS NOT NULL)
				AND (NOT ${table.superseded} OR ${table.processedAt} IS NOT NULL)
				AND (${table.processedAt} IS NULL AND ${table.deadLetteredAt} IS NULL
					OR (${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL))`,
		),
		unique("sourceWritebackJob_idempotency_unique").on(
			table.idempotencyKey,
		),
		uniqueIndex("sourceWritebackJob_item_revision_unique")
			.on(
				table.itemKey,
				table.sourceConnectionKey,
				table.canonicalRevision,
				table.operation,
			)
			.where(sql`${table.itemKey} IS NOT NULL`),
		uniqueIndex("sourceWritebackJob_collection_revision_unique")
			.on(
				table.collectionKey,
				table.sourceConnectionKey,
				table.canonicalRevision,
				table.operation,
			)
			.where(sql`${table.collectionKey} IS NOT NULL`),
		index("sourceWritebackJob_unprocessed_idx")
			.on(table.nextAttemptAt, table.id)
			.where(
				sql`${table.processedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`,
			),
		index("sourceWritebackJob_item_link_idx").on(
			table.itemKey,
			table.sourceConnectionKey,
		),
		index("sourceWritebackJob_collection_link_idx").on(
			table.collectionKey,
			table.sourceConnectionKey,
		),
	],
);

export const itemDraft = pgTable(
	"itemDraft",
	{
		itemKey: varchar("itemKey", { length: 8 }).primaryKey(),
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.default("native"),
		patch: jsonb("patch").$type<JsonObject>().notNull(),
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
			"itemDraft_patch_object",
			sql`jsonb_typeof(${table.patch}) = 'object'`,
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
		nextAttemptAt: timestampWithTimezone("nextAttemptAt")
			.notNull()
			.defaultNow(),
		leaseOwner: varchar("leaseOwner", { length: 255 }),
		leaseExpiresAt: timestampWithTimezone("leaseExpiresAt"),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		processedAt: timestampWithTimezone("processedAt"),
		deadLetteredAt: timestampWithTimezone("deadLetteredAt"),
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
		check("outbox_attempts_nonnegative", sql`${table.attempts} >= 0`),
		check(
			"outbox_lease_bundle_valid",
			sql`(
				(${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL)
				OR (${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)
			)`,
		),
		check(
			"outbox_terminal_state_valid",
			sql`NOT (${table.processedAt} IS NOT NULL AND ${table.deadLetteredAt} IS NOT NULL)
				AND (${table.processedAt} IS NULL AND ${table.deadLetteredAt} IS NULL
					OR (${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL))`,
		),
		uniqueIndex("outbox_entity_revision_unique").on(
			table.entityType,
			table.entityKey,
			table.revision,
		),
		index("outbox_unprocessed_idx")
			.on(table.nextAttemptAt, table.id)
			.where(
				sql`${table.processedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`,
			),
		index("outbox_lease_expiry_idx")
			.on(table.leaseExpiresAt)
			.where(sql`${table.leaseOwner} IS NOT NULL`),
		index("outbox_dead_lettered_idx")
			.on(table.deadLetteredAt)
			.where(
				sql`${table.processedAt} IS NULL AND ${table.deadLetteredAt} IS NOT NULL`,
			),
	],
);

export const searchIndexWorker = pgTable(
	"searchIndexWorker",
	{
		workerId: varchar("workerId", { length: 255 }).primaryKey(),
		instanceId: varchar("instanceId", { length: 64 }).notNull(),
		stage: text("stage", { enum: SEARCH_INDEX_WORKER_STAGES })
			.notNull()
			.default("starting"),
		startedAt: timestampWithTimezone("startedAt").notNull().defaultNow(),
		heartbeatAt: timestampWithTimezone("heartbeatAt")
			.notNull()
			.defaultNow(),
		stoppedAt: timestampWithTimezone("stoppedAt"),
		currentEventCount: integer("currentEventCount").notNull().default(0),
		currentTaskUid: bigint("currentTaskUid", { mode: "number" }),
		currentBatchUid: bigint("currentBatchUid", { mode: "number" }),
		currentBatchProgress: real("currentBatchProgress"),
		lastCompletedAt: timestampWithTimezone("lastCompletedAt"),
		lastError: text("lastError"),
	},
	(table) => [
		check(
			"searchIndexWorker_stage_valid",
			sql`${table.stage} IN ('starting', 'idle', 'projecting', 'waiting', 'indexing', 'retrying', 'stopping', 'stopped')`,
		),
		check(
			"searchIndexWorker_event_count_nonnegative",
			sql`${table.currentEventCount} >= 0`,
		),
		check(
			"searchIndexWorker_progress_valid",
			sql`${table.currentBatchProgress} IS NULL OR (${table.currentBatchUid} IS NOT NULL AND ${table.currentTaskUid} IS NOT NULL AND ${table.stage} = 'indexing' AND ${table.currentBatchProgress} >= 0 AND ${table.currentBatchProgress} <= 100)`,
		),
		check(
			"searchIndexWorker_work_state_valid",
			sql`(
				(${table.stage} IN ('starting', 'idle', 'retrying', 'stopping', 'stopped') AND ${table.currentEventCount} = 0 AND ${table.currentTaskUid} IS NULL AND ${table.currentBatchUid} IS NULL AND ${table.currentBatchProgress} IS NULL)
				OR (${table.stage} = 'projecting' AND ${table.currentEventCount} > 0 AND ${table.currentTaskUid} IS NULL AND ${table.currentBatchUid} IS NULL AND ${table.currentBatchProgress} IS NULL)
				OR (${table.stage} IN ('waiting', 'indexing') AND ${table.currentEventCount} > 0 AND ${table.currentTaskUid} IS NOT NULL)
			)`,
		),
		check(
			"searchIndexWorker_stopped_state_valid",
			sql`(${table.stage} = 'stopped' AND ${table.stoppedAt} IS NOT NULL) OR (${table.stage} <> 'stopped' AND ${table.stoppedAt} IS NULL)`,
		),
		index("searchIndexWorker_heartbeat_idx").on(table.heartbeatAt),
		uniqueIndex("searchIndexWorker_instance_unique").on(table.instanceId),
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
			md5: varchar("md5", { length: 32 }).notNull(),
			coverObjectPath: varchar("coverObjectPath", {
				length: 1024,
			}).notNull(),
			coverPublicUrl: varchar("coverPublicUrl", {
				length: 2048,
			}).notNull(),
			coverWidth: integer("coverWidth").notNull(),
			coverHeight: integer("coverHeight").notNull(),
			pageCount: integer("pageCount").notNull(),
			publicationTags: jsonb("publicationTags")
				.$type<string[]>()
				.notNull()
				.default([]),
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
				"itemFilePublication_md5_valid",
				sql`${table.md5} ~ '^[0-9a-f]{32}$'`,
			),
			check(
				"itemFilePublication_dimensions_positive",
				sql`${table.coverWidth} > 0 AND ${table.coverHeight} > 0 AND ${table.pageCount} > 0`,
			),
			check(
				"itemFilePublication_publication_tags_array",
				sql`jsonb_typeof(${table.publicationTags}) = 'array'`,
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
				columns: [table.parentItemKey, table.sourceConnectionKey],
				foreignColumns: [
					itemColumns.key,
					itemColumns.sourceConnectionKey,
				],
			}).onDelete("cascade"),
			unique("itemFilePublication_object_path_unique").on(
				table.objectPath,
			),
			index("itemFilePublication_parent_idx").on(table.parentItemKey),
		],
	);
}

export function createSourceRecordTables() {
	const sourceSnapshot = pgTable(
		"sourceSnapshot",
		{
			itemKey: varchar("itemKey", { length: 8 }).notNull(),
			sourceConnectionKey: varchar("sourceConnectionKey", {
				length: 64,
			}).notNull(),
			payload: jsonb("payload").$type<JsonObject>().notNull(),
			remoteVersion: varchar("remoteVersion", { length: 255 }),
			payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
			mappingProfileVersion: varchar("mappingProfileVersion", {
				length: 64,
			}),
			fetchedAt: timestampWithTimezone("fetchedAt").notNull(),
		},
		(table) => [
			primaryKey({
				columns: [table.itemKey, table.sourceConnectionKey],
			}),
			foreignKey({
				name: "sourceSnapshot_item_source_link_fk",
				columns: [table.itemKey, table.sourceConnectionKey],
				foreignColumns: [
					itemSourceLink.itemKey,
					itemSourceLink.sourceConnectionKey,
				],
			}).onDelete("cascade"),
		],
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
				name: "sourceRecordAlias_item_source_link_fk",
				columns: [table.itemKey, table.sourceConnectionKey],
				foreignColumns: [
					itemSourceLink.itemKey,
					itemSourceLink.sourceConnectionKey,
				],
			}).onDelete("cascade"),
			index("sourceRecordAlias_item_idx").on(table.itemKey),
		],
	);

	return { sourceSnapshot, sourceRecordAlias };
}
