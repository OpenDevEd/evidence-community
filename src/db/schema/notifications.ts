import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import type { DigestText, NotificationPublication, NotificationStream } from "@/lib/notifications/types";

const date = (name: string) => timestamp(name, {withTimezone: true});
export const notificationItem = pgTable("notificationItem", {
  itemKey: varchar("itemKey", {length: 8}).primaryKey(),
  firstPublishedAt: date("firstPublishedAt"),
  eligible: boolean("eligible").notNull().default(false),
  // The edition of each stream that covered this publication, listed or only counted.
  hourlyEditionId: uuid("hourlyEditionId").references(() => notificationEdition.id, {onDelete: "set null"}),
  digestEditionId: uuid("digestEditionId").references(() => notificationEdition.id, {onDelete: "set null"}),
}, table => [
  index("notificationItem_first_publication_idx").on(table.firstPublishedAt).where(sql`${table.eligible} = true`),
  // Only publications no edition has covered yet are ever scanned.
  index("notificationItem_hourly_pending_idx").on(table.firstPublishedAt).where(sql`${table.eligible} = true AND ${table.hourlyEditionId} IS NULL`),
  index("notificationItem_digest_pending_idx").on(table.firstPublishedAt).where(sql`${table.eligible} = true AND ${table.digestEditionId} IS NULL`),
]);

export const notificationState = pgTable("notificationState", {
  singleton: boolean("singleton").primaryKey().default(true),
  enabled: boolean("enabled").notNull().default(false),
  enabledAt: date("enabledAt"),
  hourlyThrough: date("hourlyThrough"),
  digestThrough: date("digestThrough"),
  nextDigestAt: date("nextDigestAt"),
  schedule: text("schedule").notNull(),
  // The worker has seen the library paused, so the next cycle that finds it running knows the pause just ended.
  digestPaused: boolean("digestPaused").notNull().default(false),
  // Additions first published up to here are in no digest: they are older than a digest reaches after a long pause.
  digestFloor: date("digestFloor"),
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
  // Every publication the window covered, including those past the listed cap.
  publicationCount: integer("publicationCount").notNull().default(0),
  cover: text("cover"),
  title: text("title"),
  summary: text("summary"),
  markdown: text("markdown"),
  // Readers see the title, summary and text above once this is set.
  publishedAt: date("publishedAt"),
  // The same three as AI wrote them, kept so a person's changes can be told from them.
  ai: jsonb("ai").$type<DigestText>(),
  // Text nobody has published yet: a rewrite of a digest readers already have.
  draft: jsonb("draft").$type<DigestText>(),
  model: text("model"),
  reasoning: text("reasoning"),
  attempts: integer("attempts").notNull().default(0),
  // An edition waits to be written while this is set. It is cleared when the text is saved or the attempts run out.
  nextAttemptAt: date("nextAttemptAt").defaultNow(),
  leaseToken: text("leaseToken"),
  leaseExpiresAt: date("leaseExpiresAt"),
  lastError: text("lastError"),
}, table => [uniqueIndex("notificationEdition_window_unique").on(table.stream, table.windowEnd), index("notificationEdition_pending_idx").on(table.nextAttemptAt).where(sql`${table.nextAttemptAt} IS NOT NULL`)]);

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
