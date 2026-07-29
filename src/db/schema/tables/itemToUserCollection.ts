import { boolean, index, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { item } from "./item";
import { userCollection } from "./userCollection";
import { users } from "./user";

export const itemToUserCollection = pgTable("itemToUserCollection", {
	id: uuid("id").unique().defaultRandom(),
	itemKey: varchar("itemKey", { length: 8 }).notNull().references(() => item.key, { onDelete: "cascade" }),
	userCollectionId: uuid("userCollectionId").notNull().references(() => userCollection.id),
	userId: text("userId").notNull().references(() => users.id),
	deleted: boolean("deleted").notNull().default(false),
	createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
}, (table) => [
	primaryKey({ columns: [table.itemKey, table.userCollectionId, table.userId] }),
	index("itemToUserCollection_collection_idx").on(table.userCollectionId),
	index("itemToUserCollection_user_idx").on(table.userId),
]);
