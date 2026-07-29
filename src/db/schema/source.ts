import {
	collectionIdentity,
	createSourceRecordTables,
	itemDraft,
	itemIdentity,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { relations } from "drizzle-orm";

import { collection } from "./tables/collection";
import { item } from "./tables/item";

export {
	collectionIdentity,
	itemDraft,
	itemIdentity,
	outbox,
	sourceConnection,
};

export const { sourceRecordAlias, sourceSnapshot } =
	createSourceRecordTables({
		key: item.key,
		sourceConnectionKey: item.sourceConnectionKey,
	});

export const sourceConnectionRelations = relations(
	sourceConnection,
	({ many }) => ({
		items: many(item),
		collections: many(collection),
		aliases: many(sourceRecordAlias),
	}),
);

export const sourceSnapshotRelations = relations(
	sourceSnapshot,
	({ one }) => ({
		item: one(item, {
			fields: [sourceSnapshot.itemKey],
			references: [item.key],
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
	}),
);
