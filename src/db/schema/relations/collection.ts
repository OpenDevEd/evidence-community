import { relations } from "drizzle-orm";
import { sourceConnection } from "@opendeved/evidence-library-core";
import { collection } from "../tables/collection";
import { itemToCollection } from "../tables/itemToCollection";

export const collectionRelations = relations(collection, ({ one, many }) => ({
    parent: one(collection, {
        fields: [collection.parentCollection],
        references: [collection.key],
        relationName: "parentToChild"
    }),
    children: many(collection, {
        relationName: "parentToChild"
    }),
    sourceConnection: one(sourceConnection, {
        fields: [collection.sourceConnectionKey],
        references: [sourceConnection.key]
    }),
    items: many(itemToCollection),
}))
