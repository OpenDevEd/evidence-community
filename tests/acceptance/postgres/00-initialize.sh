#!/bin/sh

set -eu

for database in amber indigo; do
	createdb --username "$POSTGRES_USER" "$database"
	for migration in /migrations/*.sql; do
		psql \
			--set ON_ERROR_STOP=1 \
			--username "$POSTGRES_USER" \
			--dbname "$database" \
			--file "$migration"
	done
done

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname amber <<'SQL'
UPDATE "status"
SET "totalRecords" = 1,
	"totalItems" = 1,
	"databaseUpdatedAt" = '2026-07-28T00:00:00Z'
WHERE "id" = 1;

INSERT INTO "collectionIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
VALUES
	('ZBJ4NBSL', 'native', 'ZBJ4NBSL'),
	('BBN8BK5J', 'native', 'BBN8BK5J'),
	('IW8VHV4Z', 'native', 'IW8VHV4Z');

INSERT INTO "collection" ("key", "sourceConnectionKey", "sourceRecordKey", "name", "numItems", "sortOrder")
VALUES
	('ZBJ4NBSL', 'native', 'ZBJ4NBSL', 'Amber source collection', 1, 0),
	('BBN8BK5J', 'native', 'BBN8BK5J', 'Amber theme collection', 0, 1024),
	('IW8VHV4Z', 'native', 'IW8VHV4Z', 'Amber hidden collection', 0, 2048);

INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
VALUES ('AMBR2345', 'native', 'AMBR2345');

INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "publisher", "date", "deleted")
VALUES (
	'AMBR2345',
	'native',
	'AMBR2345',
	'JournalArticle',
	'Amber database evidence',
	'Amber Institute',
	'2026',
	0
);
SQL

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname indigo <<'SQL'
UPDATE "status"
SET "totalRecords" = 1,
	"totalItems" = 1,
	"databaseUpdatedAt" = '2026-07-28T00:00:00Z'
WHERE "id" = 1;

INSERT INTO "collectionIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
VALUES
	('ZBJ4NBSL', 'native', 'ZBJ4NBSL'),
	('BBN8BK5J', 'native', 'BBN8BK5J'),
	('IW8VHV4Z', 'native', 'IW8VHV4Z');

INSERT INTO "collection" ("key", "sourceConnectionKey", "sourceRecordKey", "name", "numItems", "sortOrder")
VALUES
	('ZBJ4NBSL', 'native', 'ZBJ4NBSL', 'Indigo source collection', 1, 0),
	('BBN8BK5J', 'native', 'BBN8BK5J', 'Indigo theme collection', 0, 1024),
	('IW8VHV4Z', 'native', 'IW8VHV4Z', 'Indigo hidden collection', 0, 2048);

INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
VALUES ('INDG2345', 'native', 'INDG2345');

INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "publisher", "date", "deleted")
VALUES (
	'INDG2345',
	'native',
	'INDG2345',
	'JournalArticle',
	'Indigo database evidence',
	'Indigo Lab',
	'2025',
	0
);
SQL
