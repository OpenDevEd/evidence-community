import {
  canonicalRecordKeyCheck,
  sourceIdentityColumns,
} from '@opendeved/evidence-library-core';
import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const collection = pgTable('collection', {
  key: varchar('key', { length: 8 }).primaryKey(),
  ...sourceIdentityColumns(),

  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  numCollections: integer('numCollections').default(0),
  numItems: integer('numItems').default(0),
  name: varchar('name'),
  deleted: integer('deleted').default(0),
  deletedAt: timestamp('deletedAt', { withTimezone: true }),
  
  parentCollection: varchar('parentCollection', { length: 8 }),

  relations: jsonb(),

  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  canonicalRecordKeyCheck('collection_key_format', table.key),
  uniqueIndex('collection_source_record_unique').on(
    table.sourceConnectionKey,
    table.sourceRecordKey,
  ),
  unique('collection_key_source_connection_unique').on(
    table.key,
    table.sourceConnectionKey,
  ),
  foreignKey({
    name: 'collection_parent_source_fk',
    columns: [table.parentCollection, table.sourceConnectionKey],
    foreignColumns: [table.key, table.sourceConnectionKey],
  }),
  index('collection_source_connection_idx').on(table.sourceConnectionKey),
  index('collection_parent_idx').on(table.parentCollection),
]);
