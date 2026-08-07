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
import { relations } from "drizzle-orm";

import { collection } from "./tables/collection";
import { item } from "./tables/item";

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
	sourceConnectionKey: item.sourceConnectionKey,
});

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
