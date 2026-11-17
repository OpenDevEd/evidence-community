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

INSERT INTO "sourceConnection" ("key", "provider", "scopeKind", "config", "displayName")
VALUES (
	'openalex-acceptance',
	'openalex',
	'query',
	'{"query":"education"}'::jsonb,
	'OpenAlex acceptance'
);

INSERT INTO "itemSourceLink" ("itemKey", "sourceConnectionKey", "sourceRecordKey")
VALUES ('AMBR2345', 'openalex-acceptance', 'W100000001');

INSERT INTO "sourceRecordIssue" ("sourceConnectionKey", "sourceRecordKey", "code", "message")
VALUES (
	'openalex-acceptance',
	'W100000001',
	'zotero_fields_dropped',
	'Some fields could not be stored and were left out: creators (Choose a valid creator role.).'
);

INSERT INTO "itemCitationMetric" (
	"itemKey", "sourceConnectionKey", "citedByCount", "referencedWorksCount", "observedAt"
) VALUES (
	'AMBR2345', 'openalex-acceptance', 37, 12, '2026-07-29T12:00:00Z'
);

INSERT INTO "itemToCollection" ("itemKey", "collectionKey")
VALUES ('AMBR2345', 'ZBJ4NBSL');

INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
VALUES
	('PUBACC23', 'native', 'PUBACC23'),
	('PUBPDF23', 'native', 'PUBPDF23');

INSERT INTO "item" (
	"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision",
	"title", "abstractNote", "date", "creators", "publisher", "deleted", "licence"
) VALUES (
	'PUBACC23', 'native', 'PUBACC23', 'Report', 1,
	'Amber DOI acceptance report',
	'This report proves the local Crossref and Zenodo publication flow.',
	'2026-08-13',
	'[{"creatorType":"author","firstName":"Ada","lastName":"Lovelace","institutions":[{"display_name":"Amber Institute","country_code":"GB"},{"display_name":"Indigo College","country_code":"KE"}]}]'::jsonb,
	'Amber Evidence Library',
	0,
	'{"kind":"zenodo","id":"cc-by-4.0"}'::jsonb
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
	('PUBEXT23', 'native', 'PUBEXT23'),
	('PUBEXPA3', 'native', 'PUBEXPA3'),
	('PUBEXPB2', 'native', 'PUBEXPB2');

INSERT INTO "item" (
	"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision",
	"title", "abstractNote", "date", "creators", "publisher", "DOI", "deleted"
) VALUES (
	'PUBEXT23', 'native', 'PUBEXT23', 'Report', 1,
	'Amber external DOI archive report',
	'This report proves Zenodo file corrections under a DOI the record brought with it.',
	'2026-08-21',
	'[{"creatorType":"author","firstName":"Katherine","lastName":"Johnson"}]'::jsonb,
	'Amber Evidence Library',
	'10.1038/nature12373',
	0
);

INSERT INTO "item" (
	"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem",
	"revision", "title", "deleted"
) VALUES
	('PUBEXPA3', 'native', 'PUBEXPA3', 'Attachment', 'PUBEXT23', 1, 'External DOI PDF A', 0),
	('PUBEXPB2', 'native', 'PUBEXPB2', 'Attachment', 'PUBEXT23', 1, 'External DOI PDF B', 0);

INSERT INTO "itemFilePublication" (
	"itemKey", "sourceConnectionKey", "parentItemKey", "uploadRevision", "revision",
	"sourceObjectPath", "sourceCoverObjectPath", "objectPath", "publicUrl", "filename",
	"contentType", "sizeBytes", "sha256", "md5", "coverObjectPath", "coverPublicUrl",
	"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
) VALUES
	(
		'PUBEXPA3', 'native', 'PUBEXT23', 1, 1,
		'private/PUBEXPA3.pdf', 'private/PUBEXPA3.png', 'publication/PUBEXPA3.pdf',
		'http://storage:5000/storage/v1/object/public/amber-public/publication/PUBEXPA3.pdf',
		'amber-external-doi-a.pdf', 'application/pdf', 44,
		'5acda82c9654a06119402abf4060adb668e51d1da2115087c18a17bb421cad8f',
		'3d5de4870b943f573e6f4401a5d91938',
		'publication/PUBEXPA3.png',
		'http://storage:5000/storage/v1/object/public/amber-public/publication/PUBEXPA3.png',
		100, 140, 1, '[]'::jsonb, now()
	),
	(
		'PUBEXPB2', 'native', 'PUBEXT23', 1, 1,
		'private/PUBEXPB2.pdf', 'private/PUBEXPB2.png', 'publication/PUBEXPB2.pdf',
		'http://storage:5000/storage/v1/object/public/amber-public/publication/PUBEXPB2.pdf',
		'amber-external-doi-b.pdf', 'application/pdf', 44,
		'5acda82c9654a06119402abf4060adb668e51d1da2115087c18a17bb421cad8f',
		'3d5de4870b943f573e6f4401a5d91938',
		'publication/PUBEXPB2.png',
		'http://storage:5000/storage/v1/object/public/amber-public/publication/PUBEXPB2.png',
		100, 140, 1, '[]'::jsonb, now()
	);

INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey", "kind")
VALUES
	('PUBUIA23', 'native', 'PUBUIA23', 'created'),
	('PUBUIPDF', 'native', 'PUBUIPDF', 'created');

INSERT INTO "item" (
	"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision",
	"title", "abstractNote", "date", "creators", "publisher", "deleted", "licence"
) VALUES (
	'PUBUIA23', 'native', 'PUBUIA23', 'Report', 1,
	'Amber DOI admin interface report',
	'This report proves DOI activation and progress through the real admin interface.',
	'2026-08-13',
	'[{"creatorType":"author","firstName":"Grace","lastName":"Hopper"}]'::jsonb,
	'Amber Evidence Library',
	0,
	'{"kind":"zenodo","id":"cc-by-4.0"}'::jsonb
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
