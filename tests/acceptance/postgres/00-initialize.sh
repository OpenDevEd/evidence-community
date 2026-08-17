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

INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
VALUES
	('PUBACC23', 'native', 'PUBACC23'),
	('PUBPDF23', 'native', 'PUBPDF23');

INSERT INTO "item" (
	"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision",
	"title", "abstractNote", "date", "creators", "publisher", "deleted"
) VALUES (
	'PUBACC23', 'native', 'PUBACC23', 'Report', 1,
	'Amber DOI acceptance report',
	'This report proves the local Crossref and Zenodo publication flow.',
	'2026-08-13',
	'[{"creatorType":"author","firstName":"Ada","lastName":"Lovelace"}]'::jsonb,
	'Amber Evidence Library',
	0
);

INSERT INTO "item" (
	"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem",
	"revision", "title", "deleted"
) VALUES (
	'PUBPDF23', 'native', 'PUBPDF23', 'Attachment', 'PUBACC23',
	1, 'Amber DOI acceptance PDF', 0
);

INSERT INTO "itemFilePublication" (
	"itemKey", "sourceConnectionKey", "parentItemKey", "uploadRevision", "revision",
	"sourceObjectPath", "sourceCoverObjectPath", "objectPath", "publicUrl", "filename",
	"contentType", "sizeBytes", "sha256", "md5", "coverObjectPath", "coverPublicUrl",
	"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
) VALUES (
	'PUBPDF23', 'native', 'PUBACC23', 1, 1,
	'private/PUBPDF23.pdf', 'private/PUBPDF23.png', 'publication/PUBPDF23.pdf',
	'http://storage:5000/storage/v1/object/public/amber-public/publication/PUBPDF23.pdf',
	'amber-doi-acceptance.pdf', 'application/pdf', 44,
	'5acda82c9654a06119402abf4060adb668e51d1da2115087c18a17bb421cad8f',
	'3d5de4870b943f573e6f4401a5d91938',
	'publication/PUBPDF23.png',
	'http://storage:5000/storage/v1/object/public/amber-public/publication/PUBPDF23.png',
	100, 140, 1, '[]'::jsonb, now()
);

INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
VALUES
	('PUBUIA23', 'native', 'PUBUIA23'),
	('PUBUIPDF', 'native', 'PUBUIPDF');

INSERT INTO "item" (
	"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision",
	"title", "abstractNote", "date", "creators", "publisher", "deleted"
) VALUES (
	'PUBUIA23', 'native', 'PUBUIA23', 'Report', 1,
	'Amber DOI admin interface report',
	'This report proves DOI activation and progress through the real admin interface.',
	'2026-08-13',
	'[{"creatorType":"author","firstName":"Grace","lastName":"Hopper"}]'::jsonb,
	'Amber Evidence Library',
	0
);

INSERT INTO "item" (
	"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem",
	"revision", "title", "deleted"
) VALUES (
	'PUBUIPDF', 'native', 'PUBUIPDF', 'Attachment', 'PUBUIA23',
	1, 'Amber DOI admin interface PDF', 0
);

INSERT INTO "itemFilePublication" (
	"itemKey", "sourceConnectionKey", "parentItemKey", "uploadRevision", "revision",
	"sourceObjectPath", "sourceCoverObjectPath", "objectPath", "publicUrl", "filename",
	"contentType", "sizeBytes", "sha256", "md5", "coverObjectPath", "coverPublicUrl",
	"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
) VALUES (
	'PUBUIPDF', 'native', 'PUBUIA23', 1, 1,
	'private/PUBUIPDF.pdf', 'private/PUBUIPDF.png', 'publication/PUBUIPDF.pdf',
	'http://storage:5000/storage/v1/object/public/amber-public/publication/PUBUIPDF.pdf',
	'amber-doi-admin-interface.pdf', 'application/pdf', 44,
	'5acda82c9654a06119402abf4060adb668e51d1da2115087c18a17bb421cad8f',
	'3d5de4870b943f573e6f4401a5d91938',
	'publication/PUBUIPDF.png',
	'http://storage:5000/storage/v1/object/public/amber-public/publication/PUBUIPDF.png',
	100, 140, 1, '[]'::jsonb, now()
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
