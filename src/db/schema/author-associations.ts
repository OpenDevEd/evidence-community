import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Retry and lease columns shared by the publication association queues. */
export const associationDeliveryColumns = {
	revision: bigint("revision", {mode: "number"}).notNull(),
	attempts: integer("attempts").notNull().default(0),
	nextAttemptAt: timestamp("nextAttemptAt", {withTimezone: true}).defaultNow(),
	leaseToken: text("leaseToken"),
	leaseExpiresAt: timestamp("leaseExpiresAt", {withTimezone: true}),
	lastError: text("lastError"),
};

export const authorAssociationDelivery = pgTable("authorAssociationDelivery", {
	itemKey: varchar("itemKey", {length: 8}).primaryKey(),
	...associationDeliveryColumns,
}, table => [index("authorAssociationDelivery_pending_idx").on(table.nextAttemptAt, table.itemKey).where(sql`${table.nextAttemptAt} IS NOT NULL`)]);
