import { relations } from "drizzle-orm";
import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { item } from "./item";

/** A saved record: removing the record removes it from bookmarks and collections. */
function savedRecordColumns() {
	return {
		itemKey: varchar("itemKey", { length: 8 }).notNull().references(() => item.key, { onDelete: "cascade" }),
		createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
	};
}

/** Every reader table records when a row was made and last changed. */
function timestamps() {
	return {
		createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
	};
}

/**
 * Readers sign in with their OpenScholar account. These four tables are Better
 * Auth's user, session, account and verification models under names of their
 * own, so they never share a name with the old reader tables a rollback
 * recreates.
 */
export const readerUser = pgTable("reader_user", {
	id: text("id").primaryKey(),
	/** Empty when the OpenScholar account has no name; the library shows "Reader". */
	name: text("name").notNull(),
	/** Kept for the reader's own session only. No response sends it to anyone else. */
	email: text("email").notNull(),
	emailVerified: boolean("emailVerified").notNull().default(false),
	image: text("image"),
	clerkUserId: text("clerkUserId").notNull(),
	/** When the background check last confirmed the OpenScholar account. */
	checkedAt: timestamp("checkedAt", { mode: "date" }).notNull().defaultNow(),
	...timestamps(),
}, (table) => [uniqueIndex("reader_user_clerkUserId_idx").on(table.clerkUserId)]);

export const readerSession = pgTable("reader_session", {
	id: text("id").primaryKey(),
	token: text("token").notNull().unique(),
	userId: text("userId").notNull().references(() => readerUser.id, { onDelete: "cascade" }),
	expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
	ipAddress: text("ipAddress"),
	userAgent: text("userAgent"),
	...timestamps(),
}, (table) => [index("reader_session_userId_idx").on(table.userId)]);

export const readerAccount = pgTable("reader_account", {
	id: text("id").primaryKey(),
	/** The Clerk user ID for the OpenScholar provider. */
	accountId: text("accountId").notNull(),
	providerId: text("providerId").notNull(),
	userId: text("userId").notNull().references(() => readerUser.id, { onDelete: "cascade" }),
	accessToken: text("accessToken"),
	refreshToken: text("refreshToken"),
	idToken: text("idToken"),
	accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { mode: "date" }),
	refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { mode: "date" }),
	scope: text("scope"),
	password: text("password"),
	...timestamps(),
}, (table) => [
	index("reader_account_userId_idx").on(table.userId),
	uniqueIndex("reader_account_provider_idx").on(table.providerId, table.accountId),
]);

export const readerVerification = pgTable("reader_verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
	...timestamps(),
}, (table) => [index("reader_verification_identifier_idx").on(table.identifier)]);

/** A record the reader bookmarked. */
export const readerBookmark = pgTable("reader_bookmark", {
	userId: text("userId").notNull().references(() => readerUser.id, { onDelete: "cascade" }),
	...savedRecordColumns(),
}, (table) => [
	primaryKey({ columns: [table.userId, table.itemKey] }),
	index("reader_bookmark_itemKey_idx").on(table.itemKey),
]);

export const READER_COLLECTION_NAME_LIMIT = 24;
export const READER_COLLECTION_DESCRIPTION_LIMIT = 200;

/** A reader's own collection. Only its owner sees a private one. */
export const readerCollection = pgTable("reader_collection", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("userId").notNull().references(() => readerUser.id, { onDelete: "cascade" }),
	name: varchar("name", { length: READER_COLLECTION_NAME_LIMIT }).notNull(),
	description: varchar("description", { length: READER_COLLECTION_DESCRIPTION_LIMIT }),
	private: boolean("private").notNull().default(true),
	...timestamps(),
}, (table) => [index("reader_collection_userId_idx").on(table.userId)]);

export const readerCollectionItem = pgTable("reader_collection_item", {
	collectionId: uuid("collectionId").notNull().references(() => readerCollection.id, { onDelete: "cascade" }),
	...savedRecordColumns(),
}, (table) => [
	primaryKey({ columns: [table.collectionId, table.itemKey] }),
	index("reader_collection_item_itemKey_idx").on(table.itemKey),
]);

export const readerUserRelations = relations(readerUser, ({ many }) => ({
	sessions: many(readerSession),
	accounts: many(readerAccount),
	bookmarks: many(readerBookmark),
	collections: many(readerCollection),
}));

export const readerSessionRelations = relations(readerSession, ({ one }) => ({
	user: one(readerUser, { fields: [readerSession.userId], references: [readerUser.id] }),
}));

export const readerAccountRelations = relations(readerAccount, ({ one }) => ({
	user: one(readerUser, { fields: [readerAccount.userId], references: [readerUser.id] }),
}));

export const readerBookmarkRelations = relations(readerBookmark, ({ one }) => ({
	user: one(readerUser, { fields: [readerBookmark.userId], references: [readerUser.id] }),
}));

export const readerCollectionRelations = relations(readerCollection, ({ one, many }) => ({
	user: one(readerUser, { fields: [readerCollection.userId], references: [readerUser.id] }),
	items: many(readerCollectionItem),
}));

export const readerCollectionItemRelations = relations(readerCollectionItem, ({ one }) => ({
	collection: one(readerCollection, { fields: [readerCollectionItem.collectionId], references: [readerCollection.id] }),
}));
