import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import type { NotificationPublication, NotificationStream } from "@/lib/notifications/types";

const date = (name: string) => timestamp(name, {withTimezone: true});
export const notificationItem = pgTable("notificationItem", {
  itemKey: varchar("itemKey", {length: 8}).primaryKey(),
  firstPublishedAt: date("firstPublishedAt"),
  eligible: boolean("eligible").notNull().default(false),
}, table => [index("notificationItem_first_publication_idx").on(table.firstPublishedAt).where(sql`${table.eligible} = true`)]);

export const notificationState = pgTable("notificationState", {
  singleton: boolean("singleton").primaryKey().default(true),
  enabled: boolean("enabled").notNull().default(false),
  enabledAt: date("enabledAt"),
  hourlyThrough: date("hourlyThrough"),
  digestThrough: date("digestThrough"),
  nextDigestAt: date("nextDigestAt"),
  schedule: text("schedule").notNull(),
}, table => [check("notificationState_singleton", sql`${table.singleton} = true`)]);

export const notificationSubscriber = pgTable("notificationSubscriber", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  token: text("token").notNull(),
  digest: boolean("digest").notNull(),
  instant: boolean("instant").notNull(),
  confirmedAt: date("confirmedAt"),
  confirmationRequestedAt: date("confirmationRequestedAt").notNull().defaultNow(),
  confirmationExpiresAt: date("confirmationExpiresAt").notNull(),
  createdAt: date("createdAt").notNull().defaultNow(),
  updatedAt: date("updatedAt").notNull().defaultNow(),
}, table => [uniqueIndex("notificationSubscriber_email_unique").on(table.email), uniqueIndex("notificationSubscriber_token_unique").on(table.token)]);

export const notificationEdition = pgTable("notificationEdition", {
  id: uuid("id").primaryKey().defaultRandom(),
  stream: text("stream").$type<NotificationStream>().notNull(),
  windowStart: date("windowStart").notNull(),
  windowEnd: date("windowEnd").notNull(),
  publications: jsonb("publications").$type<NotificationPublication[]>().notNull(),
  title: text("title"),
  summary: text("summary"),
  markdown: text("markdown"),
  publishedAt: date("publishedAt"),
  model: text("model"),
  reasoning: text("reasoning"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: date("nextAttemptAt").defaultNow(),
  leaseToken: text("leaseToken"),
  leaseExpiresAt: date("leaseExpiresAt"),
  lastError: text("lastError"),
}, table => [uniqueIndex("notificationEdition_window_unique").on(table.stream, table.windowEnd), index("notificationEdition_pending_idx").on(table.nextAttemptAt).where(sql`${table.publishedAt} IS NULL`)]);

export const notificationDelivery = pgTable("notificationDelivery", {
  messageKey: text("messageKey").primaryKey(),
  subscriberId: uuid("subscriberId").notNull().references(() => notificationSubscriber.id),
  editionId: uuid("editionId").references(() => notificationEdition.id),
  status: text("status").$type<"queued" | "sending" | "sent" | "failed" | "uncertain" | "skipped">().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: date("nextAttemptAt").defaultNow(),
  leaseToken: text("leaseToken"),
  leaseExpiresAt: date("leaseExpiresAt"),
  sendStartedAt: date("sendStartedAt"),
  sentAt: date("sentAt"),
  lastError: text("lastError"),
}, table => [index("notificationDelivery_pending_idx").on(table.nextAttemptAt).where(sql`${table.status} = 'queued'`)]);
