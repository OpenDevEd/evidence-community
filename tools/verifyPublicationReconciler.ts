import assert from "node:assert/strict";
import { publicationTestConfig } from "../tests/fixtures/publication-config";
import { eq } from "drizzle-orm";
import type { Client } from "pg";
import { withIsolatedPublicationDatabase } from "../tests/helpers/isolated-publication-database";
import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Database } from "../src/db/database-schema";
import {
	publicationSyncRun,
	publicationSyncState,
} from "../src/db/schema/publication";
import { buildCrossrefPlan } from "../src/lib/publication/crossref-adapter";
import { runNightlyPublicationReconciliation } from "../src/lib/publication/reconciler";


const config = publicationTestConfig();

async function seedRecord(
	client: Client,
	input: {
		key: string;
		sequence: number;
		deleted?: boolean;
		deactivated?: boolean;
	},
) {
	const doi = `10.5555/library.${String(input.sequence).padStart(6, "0")}`;
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
		 VALUES ($1, 'reconciler-source', $1)`,
		[input.key],
	);
	await client.query(
		`INSERT INTO "item" (
			"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision",
			"title", "abstractNote", "date", "creators", "publisher", "DOI", "deleted", "deletedAt", "licence"
		) VALUES ($1, 'reconciler-source', $1, 'Report', 1, $2, 'A complete description.', '2026-08-13', $3::jsonb, 'OpenDevEd', $4, $5, $6, '{"kind":"zenodo","id":"cc-by-4.0"}'::jsonb)`,
		[
			input.key,
			`Reconciliation record ${input.sequence}`,
			JSON.stringify([
				{
					creatorType: "author",
					firstName: "Ada",
					lastName: "Lovelace",
				},
			]),
			doi,
			input.deleted ? 1 : 0,
			input.deleted ? new Date("2030-08-13T00:00:00Z") : null,
		],
	);
	await client.query(
		`INSERT INTO "publicationTarget" (
			"itemKey", "provider", "environment", "requestedBy", "deactivatedAt"
		) VALUES ($1, 'crossref', 'test', 'reconciler-verifier', $2)`,
		[
			input.key,
			input.deactivated ? new Date("2030-08-13T00:00:00Z") : null,
		],
	);
	await client.query(
		`INSERT INTO "publicationIdentifier" (
			"itemKey", "registrar", "environment", "role", "doi", "ownership", "lifecycle"
		) VALUES ($1, 'crossref', 'test', 'primary', $2, 'managed', 'reserved')`,
		[input.key, doi],
	);
}

async function seedPublishedFile(
	client: Client,
	parentItemKey: string,
	itemKey: string,
) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey")
		 VALUES ($1, 'reconciler-source', $1)`,
		[itemKey],
	);
	await client.query(
		`INSERT INTO "item" (
			"key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem",
			"revision", "title", "deleted"
		) VALUES ($1, 'reconciler-source', $1, 'Attachment', $2, 1, 'Published PDF', 0)`,
		[itemKey, parentItemKey],
	);
	await client.query(
		`INSERT INTO "itemFilePublication" (
			"itemKey", "sourceConnectionKey", "parentItemKey", "uploadRevision", "revision",
			"sourceObjectPath", "sourceCoverObjectPath", "objectPath", "publicUrl", "filename",
			"contentType", "sizeBytes", "sha256", "md5", "coverObjectPath", "coverPublicUrl",
			"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
		) VALUES (
			$1, 'reconciler-source', $2, 1, 1,
			$3, $4, $5, $6, $7,
			'application/pdf', 12, $8, $9, $10, $11,
			100, 140, 1, '[]'::jsonb, now()
		)`,
		[
			itemKey,
			parentItemKey,
			`private/${itemKey}.pdf`,
			`private/${itemKey}.png`,
			`public/${itemKey}.pdf`,
			`https://files.example.org/${itemKey}.pdf`,
			`${itemKey}.pdf`,
			"a".repeat(64),
			"b".repeat(32),
			`public/${itemKey}.png`,
			`https://files.example.org/${itemKey}.png`,
		],
	);
}

async function verify(database: Database, client: Client) {
	await client.query(
		`INSERT INTO "sourceConnection" (
			"key", "provider", "scopeKind", "externalScopeKey"
		) VALUES ('reconciler-source', 'zotero', 'group', 'reconciler-source')`,
	);
	for (const [index, key] of [
		"RECNAAAA",
		"RECNAAAB",
		"RECNAAAC",
		"RECNAAAD",
		"RECNAAAE",
		"RECNAAAF",
		"RECNAAAG",
		"RECNAAAH",
		"RECNAAAJ",
		"RECNAAAK",
		"RECNAAAM",
	].entries()) {
		await seedRecord(client, {
			key,
			sequence: index + 1,
			deactivated: ["RECNAAAF", "RECNAAAH", "RECNAAAJ"].includes(key),
			deleted: key === "RECNAAAG",
		});
	}
	for (const itemKey of ["RECNAAAH", "RECNAAAJ"]) {
		await client.query(
			`INSERT INTO "publicationTarget" (
				"itemKey", "provider", "environment", "identifierPolicy", "requestedBy"
			) VALUES ($1, 'zenodo', 'sandbox', 'mint-zenodo', 'reconciler-verifier')`,
			[itemKey],
		);
	}
	await seedPublishedFile(client, "RECNAAAH", "ATTNAAAH");

	const synced = await buildCrossrefPlan(database, "RECNAAAD", config);
	assert(
		synced.plan.status === "write_required",
		"The synced fixture did not build a Crossref payload",
	);
	await database.insert(publicationSyncState).values({
		itemKey: "RECNAAAD",
		provider: "crossref",
		environment: "test",
		lastPayloadHash: synced.plan.hashes.crossrefPayloadHash,
		lastPayloadSnapshot: synced.plan.snapshots.crossrefPayload as Record<
			string,
			unknown
		>,
	});
	await client.query(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "reason",
			"idempotencyKey", "nextAttemptAt"
		) VALUES (
			'RECNAAAE', 'crossref', 'test', 1, 'manual_activation',
			'publication:crossref:test:RECNAAAE:1', '2030-08-13T00:00:00Z'
		)`,
	);
	await client.query(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "reason",
			"idempotencyKey", "nextAttemptAt", "processedAt", "resultReceipt"
		) VALUES (
			'RECNAAAK', 'crossref', 'test', 1, 'manual_activation',
			'publication:crossref:test:RECNAAAK:1', '2030-08-13T00:00:00Z',
			'2030-08-13T00:01:00Z', '{"provider":"crossref","verified":true}'::jsonb
		)`,
	);

	const startedAt = new Date("2030-08-13T02:00:00Z");
	await client.query("BEGIN");
	await client.query(
		`SELECT pg_advisory_xact_lock(hashtextextended('item:RECNAAAM', 0))`,
	);
	const first = await runNightlyPublicationReconciliation(database, config, {
		workerId: "reconciler-worker",
		pageSize: 2,
		leaseSeconds: 300,
		now: () => startedAt,
	});
	assert(first.status === "succeeded", "The nightly scan did not finish");
	assert(
		first.scannedTargets === 9 &&
			first.pages === 5 &&
			first.enqueuedJobs === 6,
		`The nightly scan did not use keyset pages or queue only missing work: ${JSON.stringify(first)}`,
	);
	const queued = await client.query<{
		idempotencyKey: string;
		itemKey: string;
		processedAt: Date | null;
		reason: string;
	}>(
		`SELECT "itemKey", "reason", "idempotencyKey", "processedAt" FROM "publicationSyncJob"
		 WHERE "supersededAt" IS NULL ORDER BY "itemKey"`,
	);
	assert(
		queued.rows.length === 8 &&
			queued.rows.filter((row) => row.reason === "nightly_reconciliation")
				.length === 5 &&
			queued.rows.filter((row) => row.reason === "provider_audit").length ===
				1 &&
			!queued.rows.some((row) =>
				["RECNAAAF", "RECNAAAG", "RECNAAAJ"].includes(
					row.itemKey,
				),
			),
		"The nightly scan did not separate synced audits from repair work",
	);
	const repairedCurrentRevision = queued.rows.filter(
		(row) => row.itemKey === "RECNAAAK",
	);
	assert(
		repairedCurrentRevision.length === 2 &&
			repairedCurrentRevision.some((row) => row.processedAt !== null) &&
			repairedCurrentRevision.some(
				(row) =>
					row.processedAt === null &&
					row.idempotencyKey.endsWith(first.runId),
			),
		"The nightly scan could not repair a current revision whose earlier job had finished",
	);
	await client.query("ROLLBACK");
	const catchup = await runNightlyPublicationReconciliation(
		database,
		config,
		{
			workerId: "reconciler-catchup-worker",
			pageSize: 2,
			leaseSeconds: 300,
			now: () => new Date("2030-08-13T02:00:30Z"),
		},
	);
	assert(
		catchup.status === "succeeded" && catchup.enqueuedJobs === 1,
		"The next nightly scan did not repair a target skipped behind an item lock",
	);
	const busyItemJobs = await client.query<{ count: number }>(
		`SELECT count(*)::int AS count FROM "publicationSyncJob" WHERE "itemKey" = 'RECNAAAM' AND "supersededAt" IS NULL`,
	);
	assert(
		busyItemJobs.rows[0]?.count === 1,
		"The busy target was not queued exactly once after its item lock cleared",
	);

	await database.insert(publicationSyncRun).values({
		id: "nightly-busy-fixture",
		trigger: "nightly",
		status: "running",
		leaseOwner: "other-worker",
		leaseExpiresAt: new Date("2030-08-13T03:00:00Z"),
		heartbeatAt: startedAt,
		startedAt,
	});
	const busy = await runNightlyPublicationReconciliation(database, config, {
		workerId: "blocked-worker",
		pageSize: 2,
		leaseSeconds: 300,
		now: () => new Date("2030-08-13T02:01:00Z"),
	});
	assert(busy.status === "busy", "Two nightly scans ran at the same time");

	const restarted = await runNightlyPublicationReconciliation(
		database,
		config,
		{
			workerId: "replacement-worker",
			pageSize: 2,
			leaseSeconds: 300,
			now: () => new Date("2030-08-13T03:01:00Z"),
		},
	);
	assert(
		restarted.status === "succeeded" && restarted.enqueuedJobs === 0,
		"An expired scan did not restart without duplicating queued work",
	);
	const repairedJobCount = await client.query<{ count: number }>(
		`SELECT count(*)::int AS count FROM "publicationSyncJob" WHERE "itemKey" = 'RECNAAAK'`,
	);
	assert(
		repairedJobCount.rows[0]?.count === 2,
		"A second nightly scan duplicated the live repair job",
	);
	const [expired] = await database
		.select()
		.from(publicationSyncRun)
		.where(eq(publicationSyncRun.id, "nightly-busy-fixture"));
	assert(
		expired?.status === "failed" && expired.failure,
		"The expired nightly run was not recorded as failed",
	);
}

async function main() {
	await withIsolatedPublicationDatabase(async (database, client) => {
		await verify(database, client);
	});
}

describe("nightly publication reconciliation against an isolated database", () => {
	it("repairs only missing work through a singleton keyset scan", async () => {
		await main();
	}, 120_000);
});
