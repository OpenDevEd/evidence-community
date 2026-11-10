import { itemIdentity, sourceConnection } from "@opendeved/evidence-library-core";
import { bigint, doublePrecision, boolean, index, jsonb, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { associationDeliveryColumns } from "./author-associations";

/** Normalized source values remain separate from published editorial values. */
export const itemSourceValue = pgTable("itemSourceValue", {
  itemKey: varchar("itemKey", {length: 8}).notNull().references(() => itemIdentity.key),
  sourceConnectionKey: varchar("sourceConnectionKey", {length: 64}).notNull().references(() => sourceConnection.key),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  remoteVersion: text("remoteVersion"),
  importedTopics: boolean("importedTopics").notNull().default(false),
  fetchedAt: timestamp("fetchedAt", {withTimezone: true}).notNull().defaultNow(),
}, t => [primaryKey({columns: [t.itemKey, t.sourceConnectionKey]})]);

export const itemFieldOverride = pgTable("itemFieldOverride", {
  itemKey: varchar("itemKey", {length: 8}).notNull().references(() => itemIdentity.key),
  field: text("field").notNull(),
  value: jsonb("value").$type<unknown>(),
  sourceValue: jsonb("sourceValue").$type<unknown>(),
  sourceConnectionKey: varchar("sourceConnectionKey", {length: 64}).notNull().references(() => sourceConnection.key),
  sourceVersion: text("sourceVersion"),
  updatedAt: timestamp("updatedAt", {withTimezone: true}).notNull().defaultNow(),
}, t => [primaryKey({columns: [t.itemKey, t.field]})]);

export const sourceTopicAssignment = pgTable("sourceTopicAssignment", {
  itemKey: varchar("itemKey", {length: 8}).notNull().references(() => itemIdentity.key),
  sourceConnectionKey: varchar("sourceConnectionKey", {length: 64}).notNull().references(() => sourceConnection.key),
  topicId: text("topicId").notNull(), score: doublePrecision("score").notNull(), primary: boolean("primary").notNull(),
  sourceVersion: text("sourceVersion"), fetchedAt: timestamp("fetchedAt", {withTimezone: true}).notNull(),
}, t => [primaryKey({columns: [t.itemKey, t.sourceConnectionKey, t.topicId]}), index("sourceTopicAssignment_topic_idx").on(t.topicId)]);

export const topicAssociationDelivery = pgTable("topicAssociationDelivery", {
  itemKey: varchar("itemKey", {length: 8}).primaryKey(),
  generation: bigint("generation", {mode: "number"}).notNull().default(1),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  ...associationDeliveryColumns,
}, t => [index("topicAssociationDelivery_pending_idx").on(t.nextAttemptAt, t.itemKey).where(sql`${t.nextAttemptAt} IS NOT NULL`)]);

export const topicDeliveryConfiguration = pgTable("topicDeliveryConfiguration", {
  key: text("key").primaryKey(), signature: text("signature").notNull(), revisionAt: timestamp("revisionAt", {withTimezone: true}).notNull(),
});

export const topicCatalogCache = pgTable("topicCatalogCache", {
  id: text("id").primaryKey(), kind: text("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  fetchedAt: timestamp("fetchedAt", {withTimezone: true}).notNull().defaultNow(),
}, t => [index("topicCatalogCache_kind_idx").on(t.kind)]);

export const sourceReference = pgTable("sourceReference", {
  sourceConnectionKey: varchar("sourceConnectionKey", {length: 64}).notNull().references(() => sourceConnection.key),
  itemKey: varchar("itemKey", {length: 8}).notNull().references(() => itemIdentity.key),
  targetRecordKey: varchar("targetRecordKey", {length: 512}).notNull(),
}, t => [primaryKey({columns: [t.sourceConnectionKey, t.itemKey, t.targetRecordKey]}), index("sourceReference_target_idx").on(t.targetRecordKey)]);
