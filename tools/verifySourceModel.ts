import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) {
	throw new Error("DATABASE_URL_POST is required");
}

const client = new Client({ connectionString: databaseUrl });
let savepointNumber = 0;

async function expectConstraintViolation(
	label: string,
	constraint: string,
	operation: () => Promise<unknown>,
) {
	savepointNumber += 1;
	const savepoint = `expected_error_${savepointNumber}`;
	await client.query(`SAVEPOINT ${savepoint}`);

	try {
		await operation();
		await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
		throw new Error(`${label}: expected constraint ${constraint} to reject`);
	} catch (error) {
		await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
		const postgresError = error as { constraint?: string };
		if (postgresError.constraint !== constraint) {
			throw error;
		}
	} finally {
		await client.query(`RELEASE SAVEPOINT ${savepoint}`);
	}
}

async function verify() {
	await client.connect();
	await client.query("BEGIN");

	try {
		await client.query(`
			INSERT INTO "sourceConnection"
				("key", "provider", "scopeKind", "externalScopeKey", "config")
			VALUES
				('zotero-alpha', 'zotero', 'group', '1001', '{}'),
				('zotero-beta', 'zotero', 'group', '1002', '{}'),
				('openalex-main', 'openalex', 'query', NULL, '{"query":"education"}')
		`);

		await expectConstraintViolation(
			"provider scope validation",
			"sourceConnection_scope_valid",
			() =>
				client.query(`
					INSERT INTO "sourceConnection"
						("key", "provider", "scopeKind", "externalScopeKey")
					VALUES ('broken-openalex', 'openalex', 'query', 'mutable-query')
				`),
		);

		await expectConstraintViolation(
			"native connection singleton",
			"sourceConnection_scope_valid",
			() =>
				client.query(`
					INSERT INTO "sourceConnection"
						("key", "provider", "scopeKind")
					VALUES ('native-copy', 'native', 'library')
				`),
		);

		await expectConstraintViolation(
			"connection status validation",
			"sourceConnection_status_valid",
			() =>
				client.query(`
					UPDATE "sourceConnection"
					SET "status" = 'unknown'
					WHERE "key" = 'zotero-alpha'
				`),
		);

		await expectConstraintViolation(
			"remote scope uniqueness",
			"sourceConnection_provider_scope_unique",
			() =>
				client.query(`
					INSERT INTO "sourceConnection"
						("key", "provider", "scopeKind", "externalScopeKey")
					VALUES ('zotero-alpha-copy', 'zotero', 'group', '1001')
				`),
		);

		await expectConstraintViolation(
			"native item identity equality",
			"itemIdentity_native_source_key_match",
			() =>
				client.query(`
					INSERT INTO "itemIdentity"
						("key", "sourceConnectionKey", "sourceRecordKey")
					VALUES ('NATV2345', 'native', 'OTHER234')
				`),
		);

		await client.query(`
			INSERT INTO "itemIdentity"
				("key", "sourceConnectionKey", "sourceRecordKey")
			VALUES
				('AAAA2345', 'zotero-alpha', 'AAAA2345'),
				('BBBB2345', 'zotero-beta', 'AAAA2345'),
				('CCCC2345', 'zotero-alpha', 'CCCC2345'),
				('DDDD2345', 'zotero-alpha', 'DDDD2345')
		`);

		await client.query(`
			INSERT INTO "item"
				("key", "sourceConnectionKey", "sourceRecordKey", "title")
			VALUES
				('AAAA2345', 'zotero-alpha', 'AAAA2345', 'Alpha item'),
				('BBBB2345', 'zotero-beta', 'AAAA2345', 'Beta collision item'),
				('CCCC2345', 'zotero-alpha', 'CCCC2345', 'Alpha parent'),
				('DDDD2345', 'zotero-alpha', 'DDDD2345', 'Alpha child')
		`);

		await expectConstraintViolation(
			"canonical item key format",
			"itemIdentity_key_format",
			() =>
				client.query(`
					INSERT INTO "itemIdentity"
						("key", "sourceConnectionKey", "sourceRecordKey")
					VALUES ('short', 'zotero-alpha', 'short')
				`),
		);

		await expectConstraintViolation(
			"native collection identity equality",
			"collectionIdentity_native_source_key_match",
			() =>
				client.query(`
					INSERT INTO "collectionIdentity"
						("key", "sourceConnectionKey", "sourceRecordKey")
					VALUES ('NATC2345', 'native', 'OTHER234')
				`),
		);

		await client.query(`
			UPDATE "item"
			SET "parentItem" = 'CCCC2345'
			WHERE "key" = 'DDDD2345'
		`);

		await expectConstraintViolation(
			"canonical item key uniqueness",
			"itemIdentity_pkey",
			() =>
				client.query(`
					INSERT INTO "itemIdentity"
						("key", "sourceConnectionKey", "sourceRecordKey")
					VALUES ('AAAA2345', 'zotero-beta', 'OTHER234')
				`),
		);

		await expectConstraintViolation(
			"provider item identity uniqueness",
			"itemIdentity_source_record_unique",
			() =>
				client.query(`
					INSERT INTO "itemIdentity"
						("key", "sourceConnectionKey", "sourceRecordKey")
					VALUES ('EEEE2345', 'zotero-alpha', 'AAAA2345')
				`),
		);

		await expectConstraintViolation(
			"cross-source parent rejection",
			"item_parent_source_fk",
			() =>
				client.query(`
					UPDATE "item"
					SET "parentItem" = 'CCCC2345'
					WHERE "key" = 'BBBB2345'
				`),
		);

		await client.query(`
			INSERT INTO "collectionIdentity"
				("key", "sourceConnectionKey", "sourceRecordKey")
			VALUES
				('FFFF2345', 'zotero-alpha', 'FFFF2345'),
				('GGGG2345', 'zotero-beta', 'FFFF2345')
		`);

		await client.query(`
			INSERT INTO "collection"
				("key", "sourceConnectionKey", "sourceRecordKey", "name")
			VALUES
				('FFFF2345', 'zotero-alpha', 'FFFF2345', 'Alpha collection'),
				('GGGG2345', 'zotero-beta', 'FFFF2345', 'Beta collision collection')
		`);

		await expectConstraintViolation(
			"canonical collection key format",
			"collectionIdentity_key_format",
			() =>
				client.query(`
					INSERT INTO "collectionIdentity"
						("key", "sourceConnectionKey", "sourceRecordKey")
					VALUES ('BAD00000', 'zotero-alpha', 'BAD00000')
				`),
		);

		await expectConstraintViolation(
			"provider collection identity uniqueness",
			"collectionIdentity_source_record_unique",
			() =>
				client.query(`
					INSERT INTO "collectionIdentity"
						("key", "sourceConnectionKey", "sourceRecordKey")
					VALUES ('HHHH2345', 'zotero-alpha', 'FFFF2345')
				`),
		);

		await expectConstraintViolation(
			"cross-source collection parent rejection",
			"collection_parent_source_fk",
			() =>
				client.query(`
					UPDATE "collection"
					SET "parentCollection" = 'FFFF2345'
					WHERE "key" = 'GGGG2345'
				`),
		);

		await client.query(`
			INSERT INTO "sourceSnapshot"
				("itemKey", "payload", "payloadHash", "remoteVersion", "fetchedAt")
			VALUES
				('AAAA2345', '{"key":"AAAA2345"}', repeat('a', 64), '1', now())
		`);

		await client.query(`
			INSERT INTO "sourceRecordAlias"
				("sourceConnectionKey", "aliasKey", "itemKey", "kind")
			VALUES
				('zotero-alpha', '1001:AAAA2345', 'AAAA2345', 'zotero-legacy')
		`);

		await expectConstraintViolation(
			"cross-source alias rejection",
			"sourceRecordAlias_item_source_fk",
			() =>
				client.query(`
					INSERT INTO "sourceRecordAlias"
						("sourceConnectionKey", "aliasKey", "itemKey", "kind")
					VALUES
						('zotero-beta', 'wrong-source', 'AAAA2345', 'zotero-legacy')
				`),
		);

		await client.query(`
			INSERT INTO "outbox"
				("entityType", "entityKey", "operation", "revision")
			VALUES ('item', 'AAAA2345', 'upsert', 1)
		`);

		await expectConstraintViolation(
			"outbox idempotency",
			"outbox_entity_revision_unique",
			() =>
				client.query(`
					INSERT INTO "outbox"
						("entityType", "entityKey", "operation", "revision")
					VALUES ('item', 'AAAA2345', 'upsert', 1)
				`),
		);

		await expectConstraintViolation(
			"outbox entity validation",
			"outbox_entity_type_valid",
			() =>
				client.query(`
					INSERT INTO "outbox"
						("entityType", "entityKey", "operation", "revision")
					VALUES ('unknown', 'AAAA2345', 'upsert', 2)
				`),
		);

		const result = await client.query<{
			connections: string;
			items: string;
			collections: string;
			unprocessedEvents: string;
		}>(`
			SELECT
				(SELECT count(*) FROM "sourceConnection") AS connections,
				(SELECT count(*) FROM "item") AS items,
				(SELECT count(*) FROM "collection") AS collections,
				(SELECT count(*) FROM "outbox" WHERE "processedAt" IS NULL)
					AS "unprocessedEvents"
		`);

		const counts = result.rows[0];
		const expected = {
			connections: "4",
			items: "4",
			collections: "2",
			unprocessedEvents: "1",
		};

		if (JSON.stringify(counts) !== JSON.stringify(expected)) {
			throw new Error(
				`Unexpected source-model counts: ${JSON.stringify(counts)}`,
			);
		}

		console.log(JSON.stringify(counts));
	} finally {
		await client.query("ROLLBACK");
		await client.end();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
