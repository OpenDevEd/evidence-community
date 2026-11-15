import {
	collectionIdentity,
	collectionSourceLink,
	collectionSourceSnapshot,
	createItemFilePublicationTable,
	createSourceRecordTables,
	itemFileDraft,
	itemDraft,
	itemIdentity,
	itemSourceLink,
	outbox,
	searchIndexWorker,
	sourceConnection,
	sourceFileCleanup,
	sourceRecordIssue,
	sourceWritebackJob,
	sourceSyncRun,
	sourceSyncState,
} from "@opendeved/evidence-library-core";
import { relations, sql } from "drizzle-orm";
import { bigint, boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import type { OpenAlexApprovedQuery } from "@/lib/source-ingestion/openalex/schema";

import { collection } from "./tables/collection";
import { item } from "./tables/item";
import { associationDeliveryColumns } from "./author-associations";

export {
	collectionIdentity,
	collectionSourceLink,
	collectionSourceSnapshot,
	itemFileDraft,
	itemDraft,
	itemIdentity,
	itemSourceLink,
	outbox,
	searchIndexWorker,
	sourceConnection,
	sourceFileCleanup,
	sourceRecordIssue,
	sourceWritebackJob,
	sourceSyncRun,
	sourceSyncState,
};

export const { sourceRecordAlias, sourceSnapshot } = createSourceRecordTables();

export const itemFilePublication = createItemFilePublicationTable({
	key: item.key,
});

export const openAlexQueryApproval = pgTable(
	"openAlexQueryApproval",
	{
		sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 })
			.notNull()
			.references(() => sourceConnection.key),
		version: varchar("version", { length: 128 }).notNull(),
		approval: jsonb("approval").$type<OpenAlexApprovedQuery>().notNull(),
	},
	(table) => [primaryKey({ columns: [table.sourceConnectionKey, table.version] })],
);

export const sourceConnectionRelations = relations(
	sourceConnection,
	({ many }) => ({
		items: many(item),
		itemSourceLinks: many(itemSourceLink),
		collectionSourceLinks: many(collectionSourceLink),
		collections: many(collection),
		aliases: many(sourceRecordAlias),
		syncRuns: many(sourceSyncRun),
		writebackJobs: many(sourceWritebackJob),
	}),
);

export const sourceSyncRunRelations = relations(sourceSyncRun, ({ one }) => ({
	sourceConnection: one(sourceConnection, {
		fields: [sourceSyncRun.sourceConnectionKey],
		references: [sourceConnection.key],
	}),
	state: one(sourceSyncState, {
		fields: [sourceSyncRun.id],
		references: [sourceSyncState.activeRunId],
	}),
}));

export const sourceSyncStateRelations = relations(
	sourceSyncState,
	({ one }) => ({
		sourceConnection: one(sourceConnection, {
			fields: [sourceSyncState.sourceConnectionKey],
			references: [sourceConnection.key],
		}),
		activeRun: one(sourceSyncRun, {
			fields: [sourceSyncState.activeRunId],
			references: [sourceSyncRun.id],
		}),
	}),
);

export const sourceSnapshotRelations = relations(sourceSnapshot, ({ one }) => ({
	item: one(item, {
		fields: [sourceSnapshot.itemKey],
		references: [item.key],
	}),
	itemSourceLink: one(itemSourceLink, {
		fields: [sourceSnapshot.itemKey, sourceSnapshot.sourceConnectionKey],
		references: [
			itemSourceLink.itemKey,
			itemSourceLink.sourceConnectionKey,
		],
	}),
}));

export const itemSourceLinkRelations = relations(
	itemSourceLink,
	({ one, many }) => ({
		sourceConnection: one(sourceConnection, {
			fields: [itemSourceLink.sourceConnectionKey],
			references: [sourceConnection.key],
		}),
		item: one(item, {
			fields: [itemSourceLink.itemKey],
			references: [item.key],
		}),
		snapshots: many(sourceSnapshot),
		aliases: many(sourceRecordAlias),
		writebackJobs: many(sourceWritebackJob),
	}),
);

export const collectionSourceSnapshotRelations = relations(
	collectionSourceSnapshot,
	({ one }) => ({
		collection: one(collection, {
			fields: [collectionSourceSnapshot.collectionKey],
			references: [collection.key],
		}),
		collectionSourceLink: one(collectionSourceLink, {
			fields: [
				collectionSourceSnapshot.collectionKey,
				collectionSourceSnapshot.sourceConnectionKey,
			],
			references: [
				collectionSourceLink.collectionKey,
				collectionSourceLink.sourceConnectionKey,
			],
		}),
	}),
);

export const collectionSourceLinkRelations = relations(
	collectionSourceLink,
	({ one, many }) => ({
		sourceConnection: one(sourceConnection, {
			fields: [collectionSourceLink.sourceConnectionKey],
			references: [sourceConnection.key],
		}),
		collection: one(collection, {
			fields: [collectionSourceLink.collectionKey],
			references: [collection.key],
		}),
		snapshots: many(collectionSourceSnapshot),
		writebackJobs: many(sourceWritebackJob),
	}),
);

export const sourceWritebackJobRelations = relations(
	sourceWritebackJob,
	({ one }) => ({
		sourceConnection: one(sourceConnection, {
			fields: [sourceWritebackJob.sourceConnectionKey],
			references: [sourceConnection.key],
		}),
		item: one(item, {
			fields: [sourceWritebackJob.itemKey],
			references: [item.key],
		}),
		itemSourceLink: one(itemSourceLink, {
			fields: [
				sourceWritebackJob.itemKey,
				sourceWritebackJob.sourceConnectionKey,
			],
			references: [
				itemSourceLink.itemKey,
				itemSourceLink.sourceConnectionKey,
			],
		}),
		collection: one(collection, {
			fields: [sourceWritebackJob.collectionKey],
			references: [collection.key],
		}),
		collectionSourceLink: one(collectionSourceLink, {
			fields: [
				sourceWritebackJob.collectionKey,
				sourceWritebackJob.sourceConnectionKey,
			],
			references: [
				collectionSourceLink.collectionKey,
				collectionSourceLink.sourceConnectionKey,
			],
		}),
	}),
);

export const sourceRecordAliasRelations = relations(
	sourceRecordAlias,
	({ one }) => ({
		sourceConnection: one(sourceConnection, {
			fields: [sourceRecordAlias.sourceConnectionKey],
			references: [sourceConnection.key],
		}),
		item: one(item, {
			fields: [sourceRecordAlias.itemKey],
			references: [item.key],
		}),
		itemSourceLink: one(itemSourceLink, {
			fields: [
				sourceRecordAlias.itemKey,
				sourceRecordAlias.sourceConnectionKey,
			],
			references: [
				itemSourceLink.itemKey,
				itemSourceLink.sourceConnectionKey,
			],
		}),
	}),
);

/**
 * A paper added to the community by DOI or OpenAlex ID (OpenDevEd/new-el#773). Its record waits in the review queue
 * while `pending`; once `accepted`, the Added papers source keeps it up to date from OpenAlex. A paper OpenAlex
 * doesn't have yet keeps no `openalexId`, and each sync looks for it there again by its DOI.
 */
export const addedPaper = pgTable(
	"addedPaper",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		itemKey: varchar("itemKey", { length: 64 }).notNull().unique().references(() => itemIdentity.key),
		openalexId: varchar("openalexId", { length: 32 }),
		doi: varchar("doi", { length: 512 }),
		state: text("state", { enum: ["pending", "accepted"] }).notNull(),
		/** Who sent it: their OpenScholar user, and their name as the queue shows it. */
		addedBy: varchar("addedBy", { length: 128 }).notNull(),
		addedByName: varchar("addedByName", { length: 255 }),
		/** Their address as Openscholar sent it, for a sender who never signed in to the library. */
		addedByEmail: varchar("addedByEmail", { length: 320 }),
		/** The OpenScholar request that sent it, so a repeated request adds nothing twice. */
		requestId: varchar("requestId", { length: 128 }).notNull(),
		/** The later requests that sent it again after its review was returned or withdrawn. */
		resendRequestIds: varchar("resendRequestIds", { length: 128 }).array().notNull().default(sql`'{}'`),
		/** Suggested by someone outside the community's team, who may only send it to the review queue. */
		suggested: boolean("suggested").notNull().default(false),
		addedAt: timestamp("addedAt", { withTimezone: true }).notNull().defaultNow(),
		acceptedAt: timestamp("acceptedAt", { withTimezone: true }),
	},
	(table) => [
		check("addedPaper_state_valid", sql`${table.state} IN ('pending', 'accepted')`),
		check("addedPaper_identified", sql`${table.openalexId} IS NOT NULL OR ${table.doi} IS NOT NULL`),
		uniqueIndex("addedPaper_openalex_unique").on(table.openalexId).where(sql`${table.openalexId} IS NOT NULL`),
		uniqueIndex("addedPaper_doi_unique").on(table.doi).where(sql`${table.doi} IS NOT NULL`),
		index("addedPaper_request_idx").on(table.requestId),
		index("addedPaper_unresolved_idx").on(table.state).where(sql`${table.openalexId} IS NULL`),
		index("addedPaper_suggested_idx").on(table.addedAt).where(sql`${table.suggested}`),
		index("addedPaper_added_by_idx").on(table.addedBy, table.addedAt),
	],
);

/**
 * An added paper's change of state for Openscholar to keep (OpenDevEd/new-el#778): approved, returned or withdrawn.
 * A newer change of the same paper takes the row over; each is sent until Openscholar answers.
 */
export const submissionStatusDelivery = pgTable(
	"submissionStatusDelivery",
	{
		itemKey: varchar("itemKey", { length: 64 }).primaryKey(),
		generation: bigint("generation", { mode: "number" }).notNull().default(1),
		payload: jsonb("payload").$type<Record<string, unknown>>(),
		...associationDeliveryColumns,
	},
	(table) => [index("submissionStatusDelivery_pending_idx").on(table.nextAttemptAt, table.itemKey).where(sql`${table.nextAttemptAt} IS NOT NULL`)],
);
