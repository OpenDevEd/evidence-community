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
INSERT INTO "status" ("totalRecords", "totalItems", "databaseUpdatedAt")
VALUES (1, 1, '2026-07-28T00:00:00Z');

INSERT INTO "collection" ("key", "name", "numItems")
VALUES
	('ZBJ4NBSL', 'Amber source collection', 1),
	('BBN8BK5J', 'Amber theme collection', 0),
	('IW8VHV4Z', 'Amber hidden collection', 0);

INSERT INTO "item" ("key", "itemType", "title", "institution", "date", "deleted")
VALUES (
	'AMBER_DATABASE_FIXTURE',
	'JournalArticle',
	'Amber database evidence',
	'Amber Institute',
	'2026',
	0
);
SQL

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname indigo <<'SQL'
INSERT INTO "status" ("totalRecords", "totalItems", "databaseUpdatedAt")
VALUES (1, 1, '2026-07-28T00:00:00Z');

INSERT INTO "collection" ("key", "name", "numItems")
VALUES
	('ZBJ4NBSL', 'Indigo source collection', 1),
	('BBN8BK5J', 'Indigo theme collection', 0),
	('IW8VHV4Z', 'Indigo hidden collection', 0);

INSERT INTO "item" ("key", "itemType", "title", "institution", "date", "deleted")
VALUES (
	'INDIGO_DATABASE_FIXTURE',
	'JournalArticle',
	'Indigo database evidence',
	'Indigo Lab',
	'2025',
	0
);
SQL
