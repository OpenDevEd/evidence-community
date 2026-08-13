import { itemIdentity } from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
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

export const PUBLICATION_PROVIDERS = ["crossref", "zenodo"] as const;
export const PUBLICATION_ENVIRONMENTS = ["test", "sandbox"] as const;
export const ZENODO_IDENTIFIER_POLICIES = [
	"reuse-crossref",
	"mint-zenodo",
] as const;
export const PUBLICATION_IDENTIFIER_ROLES = [
	"primary",
	"version",
	"concept",
] as const;
export const PUBLICATION_IDENTIFIER_OWNERSHIP = [
	"managed",
	"external",
] as const;
export const PUBLICATION_IDENTIFIER_LIFECYCLES = [
	"reserved",
	"verified",
] as const;
export const PUBLICATION_JOB_REASONS = [
	"manual_activation",
	"manual_retry",
	"record_changed",
	"file_changed",
	"nightly_reconciliation",
] as const;
export const ZENODO_JOURNAL_OPERATIONS = [
	"zenodo_create",
	"zenodo_metadata_update",
	"zenodo_file_update",
	"zenodo_new_version",
] as const;
export const ZENODO_JOURNAL_STATUSES = [
	"preparing",
	"ready_to_publish",
	"published",
] as const;
export const PUBLICATION_RUN_TRIGGERS = [
	"immediate",
	"nightly",
	"manual",
] as const;
export const PUBLICATION_RUN_STATUSES = [
	"running",
	"succeeded",
	"failed",
] as const;

export type PublicationProvider = (typeof PUBLICATION_PROVIDERS)[number];
export type PublicationEnvironment =
	(typeof PUBLICATION_ENVIRONMENTS)[number];
export type ZenodoIdentifierPolicy =
	(typeof ZENODO_IDENTIFIER_POLICIES)[number];

type JsonObject = Record<string, unknown>;

const timestampWithTimezone = (name: string) =>
	timestamp(name, { withTimezone: true });

export const doiNamespace = pgTable(
	"doiNamespace",
	{
		environment: text("environment", {
			enum: ["test"],
		}).primaryKey(),
		prefix: varchar("prefix", { length: 12 }).notNull(),
		suffixNamespace: varchar("suffixNamespace", { length: 64 }).notNull(),
		nextSequence: bigint("nextSequence", { mode: "number" })
			.notNull()
			.default(1),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		check("doiNamespace_environment_valid", sql`${table.environment} = 'test'`),
		check(
			"doiNamespace_prefix_valid",
			sql`${table.prefix} ~ '^10\\.[0-9]{4,9}$'`,
		),
		check(
			"doiNamespace_suffix_valid",
			sql`${table.suffixNamespace} ~ '^[a-z0-9][a-z0-9._-]*$'`,
		),
		check(
			"doiNamespace_next_sequence_positive",
			sql`${table.nextSequence} >= 1`,
		),
		unique("doiNamespace_prefix_suffix_unique").on(
			table.prefix,
			table.suffixNamespace,
		),
	],
);

export const publicationTarget = pgTable(
	"publicationTarget",
	{
		itemKey: varchar("itemKey", { length: 8 })
			.notNull()
			.references(() => itemIdentity.key, { onDelete: "restrict" }),
		provider: text("provider", { enum: PUBLICATION_PROVIDERS }).notNull(),
		environment: text("environment", {
			enum: PUBLICATION_ENVIRONMENTS,
		}).notNull(),
		identifierPolicy: text("identifierPolicy", {
			enum: ZENODO_IDENTIFIER_POLICIES,
		}),
		requestedBy: varchar("requestedBy", { length: 255 }).notNull(),
		requestedAt: timestampWithTimezone("requestedAt").notNull().defaultNow(),
		deactivatedAt: timestampWithTimezone("deactivatedAt"),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({
			columns: [table.itemKey, table.provider, table.environment],
		}),
		check(
			"publicationTarget_provider_environment_valid",
			sql`(
				(${table.provider} = 'crossref' AND ${table.environment} = 'test')
				OR (${table.provider} = 'zenodo' AND ${table.environment} = 'sandbox')
			)`,
		),
		check(
			"publicationTarget_identifier_policy_valid",
			sql`(
				(${table.provider} = 'crossref' AND ${table.identifierPolicy} IS NULL)
				OR (${table.provider} = 'zenodo'
					AND ${table.identifierPolicy} IS NOT NULL
					AND ${table.identifierPolicy} IN ('reuse-crossref', 'mint-zenodo'))
			)`,
		),
		index("publicationTarget_item_active_idx")
			.on(table.itemKey)
			.where(sql`${table.deactivatedAt} IS NULL`),
	],
);

export const publicationIdentifier = pgTable(
	"publicationIdentifier",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		itemKey: varchar("itemKey", { length: 8 }).notNull(),
		registrar: text("registrar", { enum: PUBLICATION_PROVIDERS }).notNull(),
		environment: text("environment", {
			enum: PUBLICATION_ENVIRONMENTS,
		}).notNull(),
		role: text("role", { enum: PUBLICATION_IDENTIFIER_ROLES }).notNull(),
		doi: varchar("doi", { length: 255 }).notNull(),
		ownership: text("ownership", {
			enum: PUBLICATION_IDENTIFIER_OWNERSHIP,
		}).notNull(),
		lifecycle: text("lifecycle", {
			enum: PUBLICATION_IDENTIFIER_LIFECYCLES,
		}).notNull(),
		isCurrent: boolean("isCurrent").notNull().default(true),
		reservedAt: timestampWithTimezone("reservedAt").notNull().defaultNow(),
		verifiedAt: timestampWithTimezone("verifiedAt"),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "publicationIdentifier_target_fk",
			columns: [table.itemKey, table.registrar, table.environment],
			foreignColumns: [
				publicationTarget.itemKey,
				publicationTarget.provider,
				publicationTarget.environment,
			],
		}).onDelete("restrict"),
		check(
			"publicationIdentifier_provider_shape_valid",
			sql`(
				(${table.registrar} = 'crossref' AND ${table.environment} = 'test' AND ${table.role} = 'primary')
				OR (${table.registrar} = 'zenodo' AND ${table.environment} = 'sandbox' AND ${table.role} IN ('primary', 'version', 'concept'))
			)`,
		),
		check(
			"publicationIdentifier_doi_valid",
			sql`${table.doi} ~ '^10\\.[0-9]{4,9}/[^[:space:]]{1,200}$' AND ${table.doi} = lower(${table.doi})`,
		),
		check(
			"publicationIdentifier_external_verified",
			sql`${table.ownership} <> 'external' OR ${table.lifecycle} = 'verified'`,
		),
		check(
			"publicationIdentifier_ownership_valid",
			sql`${table.ownership} IN ('managed', 'external')`,
		),
		check(
			"publicationIdentifier_lifecycle_valid",
			sql`${table.lifecycle} IN ('reserved', 'verified')`,
		),
		check(
			"publicationIdentifier_verified_bundle_valid",
			sql`(
				(${table.lifecycle} = 'reserved' AND ${table.verifiedAt} IS NULL)
				OR (${table.lifecycle} = 'verified' AND ${table.verifiedAt} IS NOT NULL)
			)`,
		),
		unique("publicationIdentifier_provider_doi_unique").on(
			table.registrar,
			table.environment,
			table.doi,
		),
		uniqueIndex("publicationIdentifier_current_role_unique")
			.on(table.itemKey, table.registrar, table.environment, table.role)
			.where(sql`${table.isCurrent} = true`),
		index("publicationIdentifier_item_idx").on(table.itemKey),
	],
);

export const publicationSyncState = pgTable(
	"publicationSyncState",
	{
		itemKey: varchar("itemKey", { length: 8 }).notNull(),
		provider: text("provider", { enum: PUBLICATION_PROVIDERS }).notNull(),
		environment: text("environment", {
			enum: PUBLICATION_ENVIRONMENTS,
		}).notNull(),
		identifierPolicy: text("identifierPolicy", {
			enum: ZENODO_IDENTIFIER_POLICIES,
		}),
		lastPayloadHash: varchar("lastPayloadHash", { length: 64 }),
		lastPayloadSnapshot: jsonb("lastPayloadSnapshot").$type<JsonObject>(),
		lastFileManifestHash: varchar("lastFileManifestHash", { length: 64 }),
		lastFileManifestSnapshot:
			jsonb("lastFileManifestSnapshot").$type<JsonObject>(),
		pendingStage: text("pendingStage", {
			enum: ["relation_clear", "deposit"],
		}),
		pendingPayloadHash: varchar("pendingPayloadHash", { length: 64 }),
		pendingPayloadSnapshot:
			jsonb("pendingPayloadSnapshot").$type<JsonObject>(),
		pendingBatchId: varchar("pendingBatchId", { length: 255 }),
		pendingFilename: varchar("pendingFilename", { length: 255 }),
		pendingSubmittedAt: timestampWithTimezone("pendingSubmittedAt"),
		pendingReason: text("pendingReason"),
		zenodoRecordId: varchar("zenodoRecordId", { length: 255 }),
		zenodoParentId: varchar("zenodoParentId", { length: 255 }),
		zenodoVersionDoi: varchar("zenodoVersionDoi", { length: 255 }),
		zenodoConceptDoi: varchar("zenodoConceptDoi", { length: 255 }),
		orphanDraftDepositionId: varchar("orphanDraftDepositionId", {
			length: 255,
		}),
		lastFailureClass: varchar("lastFailureClass", { length: 255 }),
		lastFailureSummary: text("lastFailureSummary"),
		consecutiveFailures: integer("consecutiveFailures").notNull().default(0),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({
			columns: [table.itemKey, table.provider, table.environment],
		}),
		foreignKey({
			name: "publicationSyncState_target_fk",
			columns: [table.itemKey, table.provider, table.environment],
			foreignColumns: [
				publicationTarget.itemKey,
				publicationTarget.provider,
				publicationTarget.environment,
			],
		}).onDelete("cascade"),
		check(
			"publicationSyncState_provider_fields_valid",
			sql`(
				(${table.provider} = 'crossref'
					AND ${table.environment} = 'test'
					AND ${table.identifierPolicy} IS NULL
					AND ${table.lastFileManifestHash} IS NULL
					AND ${table.lastFileManifestSnapshot} IS NULL
					AND ${table.zenodoRecordId} IS NULL
					AND ${table.zenodoParentId} IS NULL
					AND ${table.zenodoVersionDoi} IS NULL
					AND ${table.zenodoConceptDoi} IS NULL
					AND ${table.orphanDraftDepositionId} IS NULL)
				OR (${table.provider} = 'zenodo'
					AND ${table.environment} = 'sandbox'
					AND ${table.identifierPolicy} IS NOT NULL
					AND ${table.identifierPolicy} IN ('reuse-crossref', 'mint-zenodo')
					AND ${table.pendingStage} IS NULL
					AND ${table.pendingPayloadHash} IS NULL
					AND ${table.pendingPayloadSnapshot} IS NULL
					AND ${table.pendingBatchId} IS NULL
					AND ${table.pendingFilename} IS NULL
					AND ${table.pendingSubmittedAt} IS NULL
					AND ${table.pendingReason} IS NULL)
			)`,
		),
		check(
			"publicationSyncState_last_success_bundle_valid",
			sql`(
				(${table.lastPayloadHash} IS NULL AND ${table.lastPayloadSnapshot} IS NULL)
				OR (${table.lastPayloadHash} ~ '^[0-9a-f]{64}$' AND ${table.lastPayloadSnapshot} IS NOT NULL)
			)`,
		),
		check(
			"publicationSyncState_file_bundle_valid",
			sql`(
				(${table.lastFileManifestHash} IS NULL AND ${table.lastFileManifestSnapshot} IS NULL)
				OR (${table.lastFileManifestHash} ~ '^[0-9a-f]{64}$' AND ${table.lastFileManifestSnapshot} IS NOT NULL)
			)`,
		),
		check(
			"publicationSyncState_pending_bundle_valid",
			sql`(
				(${table.pendingStage} IS NULL
					AND ${table.pendingPayloadHash} IS NULL
					AND ${table.pendingPayloadSnapshot} IS NULL
					AND ${table.pendingBatchId} IS NULL
					AND ${table.pendingFilename} IS NULL
					AND ${table.pendingSubmittedAt} IS NULL
					AND ${table.pendingReason} IS NULL)
				OR (${table.pendingStage} IS NOT NULL AND ${table.pendingPayloadHash} ~ '^[0-9a-f]{64}$')
			)`,
		),
		check(
			"publicationSyncState_zenodo_identifiers_bundle_valid",
			sql`(
				(${table.zenodoRecordId} IS NULL AND ${table.zenodoParentId} IS NULL)
				OR (${table.zenodoRecordId} IS NOT NULL AND ${table.zenodoParentId} IS NOT NULL)
			)`,
		),
		check(
			"publicationSyncState_failure_bundle_valid",
			sql`(
				(${table.consecutiveFailures} = 0 AND ${table.lastFailureClass} IS NULL AND ${table.lastFailureSummary} IS NULL)
				OR (${table.consecutiveFailures} > 0 AND ${table.lastFailureClass} IS NOT NULL AND ${table.lastFailureSummary} IS NOT NULL)
			)`,
		),
	],
);

export const publicationSyncJob = pgTable(
	"publicationSyncJob",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		itemKey: varchar("itemKey", { length: 8 }).notNull(),
		provider: text("provider", { enum: PUBLICATION_PROVIDERS }).notNull(),
		environment: text("environment", {
			enum: PUBLICATION_ENVIRONMENTS,
		}).notNull(),
		canonicalRevision: bigint("canonicalRevision", { mode: "number" }).notNull(),
		fileRevision: bigint("fileRevision", { mode: "number" }),
		reason: text("reason", { enum: PUBLICATION_JOB_REASONS }).notNull(),
		idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("lastError"),
		nextAttemptAt: timestampWithTimezone("nextAttemptAt").notNull().defaultNow(),
		leaseOwner: varchar("leaseOwner", { length: 255 }),
		leaseExpiresAt: timestampWithTimezone("leaseExpiresAt"),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
		processedAt: timestampWithTimezone("processedAt"),
		deadLetteredAt: timestampWithTimezone("deadLetteredAt"),
		supersededAt: timestampWithTimezone("supersededAt"),
		resultReceipt: jsonb("resultReceipt").$type<JsonObject>(),
	},
	(table) => [
		foreignKey({
			name: "publicationSyncJob_target_fk",
			columns: [table.itemKey, table.provider, table.environment],
			foreignColumns: [
				publicationTarget.itemKey,
				publicationTarget.provider,
				publicationTarget.environment,
			],
		}).onDelete("cascade"),
		check(
			"publicationSyncJob_revisions_positive",
			sql`${table.canonicalRevision} >= 1 AND (${table.fileRevision} IS NULL OR ${table.fileRevision} >= 1)`,
		),
		check("publicationSyncJob_attempts_nonnegative", sql`${table.attempts} >= 0`),
		check(
			"publicationSyncJob_reason_valid",
			sql`${table.reason} IN ('manual_activation', 'manual_retry', 'record_changed', 'file_changed', 'nightly_reconciliation')`,
		),
		check(
			"publicationSyncJob_lease_bundle_valid",
			sql`(
				(${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL)
				OR (${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)
			)`,
		),
		check(
			"publicationSyncJob_terminal_state_valid",
			sql`num_nonnulls(${table.processedAt}, ${table.deadLetteredAt}, ${table.supersededAt}) <= 1
				AND (num_nonnulls(${table.processedAt}, ${table.deadLetteredAt}, ${table.supersededAt}) = 0
					OR (${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL))`,
		),
		check(
			"publicationSyncJob_receipt_bundle_valid",
			sql`(${table.processedAt} IS NULL AND ${table.resultReceipt} IS NULL)
				OR (${table.processedAt} IS NOT NULL AND ${table.resultReceipt} IS NOT NULL)`,
		),
		unique("publicationSyncJob_idempotency_unique").on(table.idempotencyKey),
		index("publicationSyncJob_ready_idx")
			.on(table.nextAttemptAt, table.id)
			.where(
				sql`${table.processedAt} IS NULL AND ${table.deadLetteredAt} IS NULL AND ${table.supersededAt} IS NULL`,
			),
		index("publicationSyncJob_lease_expiry_idx")
			.on(table.leaseExpiresAt)
			.where(sql`${table.leaseOwner} IS NOT NULL`),
		index("publicationSyncJob_item_created_idx").on(
			table.itemKey,
			table.createdAt,
		),
	],
);

export const zenodoPublishJournal = pgTable(
	"zenodoPublishJournal",
	{
		id: bigint("id", { mode: "number" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		itemKey: varchar("itemKey", { length: 8 }).notNull(),
		provider: text("provider", { enum: ["zenodo"] })
			.notNull()
			.default("zenodo"),
		environment: text("environment", { enum: ["sandbox"] })
			.notNull()
			.default("sandbox"),
		operationType: text("operationType", {
			enum: ZENODO_JOURNAL_OPERATIONS,
		}).notNull(),
		payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
		payloadSnapshot: jsonb("payloadSnapshot").$type<JsonObject>().notNull(),
		fileManifestHash: varchar("fileManifestHash", { length: 64 }),
		fileManifestSnapshot:
			jsonb("fileManifestSnapshot").$type<JsonObject>(),
		depositionId: varchar("depositionId", { length: 255 }).notNull(),
		draftRecordId: varchar("draftRecordId", { length: 255 }).notNull(),
		parentId: varchar("parentId", { length: 255 }),
		status: text("status", { enum: ZENODO_JOURNAL_STATUSES }).notNull(),
		publishedRecordId: varchar("publishedRecordId", { length: 255 }),
		identifiers: jsonb("identifiers").$type<JsonObject>(),
		orphanDraftCleanupDepositionId: varchar(
			"orphanDraftCleanupDepositionId",
			{ length: 255 },
		),
		createdAt: timestampWithTimezone("createdAt").notNull().defaultNow(),
		updatedAt: timestampWithTimezone("updatedAt").notNull().defaultNow(),
		publishedAt: timestampWithTimezone("publishedAt"),
	},
	(table) => [
		foreignKey({
			name: "zenodoPublishJournal_target_fk",
			columns: [table.itemKey, table.provider, table.environment],
			foreignColumns: [
				publicationTarget.itemKey,
				publicationTarget.provider,
				publicationTarget.environment,
			],
		}).onDelete("cascade"),
		check(
			"zenodoPublishJournal_provider_environment_valid",
			sql`${table.provider} = 'zenodo' AND ${table.environment} = 'sandbox'`,
		),
		check(
			"zenodoPublishJournal_hashes_valid",
			sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'
				AND ((${table.fileManifestHash} IS NULL AND ${table.fileManifestSnapshot} IS NULL)
					OR (${table.fileManifestHash} ~ '^[0-9a-f]{64}$' AND ${table.fileManifestSnapshot} IS NOT NULL))`,
		),
		check(
			"zenodoPublishJournal_operation_valid",
			sql`${table.operationType} IN ('zenodo_create', 'zenodo_metadata_update', 'zenodo_file_update', 'zenodo_new_version')`,
		),
		check(
			"zenodoPublishJournal_published_bundle_valid",
			sql`(
				(${table.status} IN ('preparing', 'ready_to_publish')
					AND ${table.publishedRecordId} IS NULL
					AND ${table.identifiers} IS NULL
					AND ${table.publishedAt} IS NULL)
				OR (${table.status} = 'published'
					AND ${table.publishedRecordId} IS NOT NULL
					AND ${table.identifiers} IS NOT NULL
					AND ${table.publishedAt} IS NOT NULL)
			)`,
		),
		unique("zenodoPublishJournal_deposition_unique").on(
			table.environment,
			table.depositionId,
		),
		index("zenodoPublishJournal_item_status_idx").on(
			table.itemKey,
			table.status,
		),
	],
);

export const publicationSyncRun = pgTable(
	"publicationSyncRun",
	{
		id: varchar("id", { length: 64 }).primaryKey(),
		trigger: text("trigger", { enum: PUBLICATION_RUN_TRIGGERS }).notNull(),
		status: text("status", { enum: PUBLICATION_RUN_STATUSES })
			.notNull()
			.default("running"),
		leaseOwner: varchar("leaseOwner", { length: 255 }),
		leaseExpiresAt: timestampWithTimezone("leaseExpiresAt"),
		heartbeatAt: timestampWithTimezone("heartbeatAt"),
		claimedJobs: integer("claimedJobs").notNull().default(0),
		succeededJobs: integer("succeededJobs").notNull().default(0),
		failedJobs: integer("failedJobs").notNull().default(0),
		startedAt: timestampWithTimezone("startedAt").notNull().defaultNow(),
		completedAt: timestampWithTimezone("completedAt"),
		result: jsonb("result").$type<JsonObject>(),
		failure: text("failure"),
	},
	(table) => [
		check(
			"publicationSyncRun_counts_valid",
			sql`${table.claimedJobs} >= 0 AND ${table.succeededJobs} >= 0 AND ${table.failedJobs} >= 0
				AND ${table.succeededJobs} + ${table.failedJobs} <= ${table.claimedJobs}`,
		),
		check(
			"publicationSyncRun_trigger_valid",
			sql`${table.trigger} IN ('immediate', 'nightly', 'manual')`,
		),
		check(
			"publicationSyncRun_state_bundle_valid",
			sql`(
				(${table.status} = 'running'
					AND ${table.leaseOwner} IS NOT NULL
					AND ${table.leaseExpiresAt} IS NOT NULL
					AND ${table.heartbeatAt} IS NOT NULL
					AND ${table.completedAt} IS NULL)
				OR (${table.status} IN ('succeeded', 'failed')
					AND ${table.leaseOwner} IS NULL
					AND ${table.leaseExpiresAt} IS NULL
					AND ${table.completedAt} IS NOT NULL)
			)`,
		),
		check(
			"publicationSyncRun_failure_valid",
			sql`(${table.status} = 'failed' AND ${table.failure} IS NOT NULL)
				OR (${table.status} <> 'failed' AND ${table.failure} IS NULL)`,
		),
		index("publicationSyncRun_status_started_idx").on(
			table.status,
			table.startedAt,
		),
	],
);
