import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const authorAssociationDelivery = pgTable("authorAssociationDelivery", {
	itemKey: varchar("itemKey", {length: 8}).primaryKey(),
	revision: bigint("revision", {mode: "number"}).notNull(),
	attempts: integer("attempts").notNull().default(0),
	nextAttemptAt: timestamp("nextAttemptAt", {withTimezone: true}).defaultNow(),
	leaseToken: text("leaseToken"),
	leaseExpiresAt: timestamp("leaseExpiresAt", {withTimezone: true}),
	lastError: text("lastError"),
}, table => [index("authorAssociationDelivery_pending_idx").on(table.nextAttemptAt).where(sql`${table.nextAttemptAt} IS NOT NULL`)]);
