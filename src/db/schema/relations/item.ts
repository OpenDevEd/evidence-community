import { relations } from "drizzle-orm";
import { sourceConnection } from "@opendeved/evidence-library-core";
import { item } from "../tables/item";
import { language } from "../tables/language";
import { itemToTag } from "../tables/itemToTag";
import { itemToCollection } from "../tables/itemToCollection";
import { usersToLikes } from "../tables/userToLikes";

export const itemRelations = relations(item, ({ many, one }) => ({
    itemTags: many(itemToTag),
    language: one(language, {
        fields: [item.languageName],
        references: [language.name]
    }),
    sourceConnection: one(sourceConnection, {
        fields: [item.sourceConnectionKey],
        references: [sourceConnection.key]
    }),
    collections: many(itemToCollection),
    likes: many(usersToLikes),
}));
