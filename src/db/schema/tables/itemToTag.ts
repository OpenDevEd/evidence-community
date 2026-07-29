import { index, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { item } from './item';
import { tag } from './tag';

export const itemToTag = pgTable(
  'itemToTag',
  {
    itemKey: varchar('itemKey', { length: 8 })
      .notNull()
      .references(() => item.key, { onDelete: 'cascade' }),
    tagName: varchar('tagName', { length: 255 })
      .references(() => tag.name)
      .notNull(),

    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.itemKey, table.tagName] }),
    index('itemToTag_tag_idx').on(table.tagName),
  ],
);
