import {
	collectionIdentity,
	createItemFilePublicationTable,
	createSourceRecordTables,
	itemFileDraft,
	itemDraft,
	itemIdentity,
	outbox,
	searchIndexWorker,
	sourceConnection,
	sourceSyncRun,
	sourceSyncState,
} from "@opendeved/evidence-library-core";
import { relations } from "drizzle-orm";

import { collection } from "./tables/collection";
import { item } from "./tables/item";

export {
	collectionIdentity,
	itemFileDraft,
	itemDraft,
	itemIdentity,
	outbox,
	searchIndexWorker,
	sourceConnection,
	sourceSyncRun,
	sourceSyncState,
};

export const { sourceRecordAlias, sourceSnapshot } = createSourceRecordTables({
	key: item.key,
	sourceConnectionKey: item.sourceConnectionKey,
});

export const itemFilePublication = createItemFilePublicationTable({
	key: item.key,
	sourceConnectionKey: item.sourceConnectionKey,
});

export const sourceConnectionRelations = relations(
	sourceConnection,
	({ many }) => ({
		items: many(item),
		collections: many(collection),
		aliases: many(sourceRecordAlias),
		syncRuns: many(sourceSyncRun),
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
}));

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
	}),
);
