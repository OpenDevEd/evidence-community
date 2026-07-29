import { index, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { item } from './item';
import { collection } from './collection';

export const itemToCollection = pgTable(
  'itemToCollection',
  {
    itemKey: varchar({ length: 8 })
      .notNull()
      .references(() => item.key, { onDelete: 'cascade' }),
    collectionKey: varchar({ length: 8 })
      .notNull()
      .references(() => collection.key, { onDelete: 'cascade' }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.itemKey, table.collectionKey] }),
    index('itemToCollection_collection_idx').on(table.collectionKey),
  ],
);
