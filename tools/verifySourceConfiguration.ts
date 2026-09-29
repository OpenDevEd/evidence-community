import { sourceConnection } from "@opendeved/evidence-library-core";
import { eq, inArray } from "drizzle-orm";

import { loadLibraryConfig } from "../src/config/library-config/source";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import {
	reconcileConfiguredSources,
	SourceConfigurationConflictError,
} from "../src/lib/source-ingestion/configuration";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

const primaryKey = "zotero-config-test-primary";
const secondaryKey = "zotero-config-test-secondary";
const testKeys = [primaryKey, secondaryKey];

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function verify() {
	const config = await loadLibraryConfig();
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const database = resource.database;
	const settings = config.sources.find((source) => source.provider === "zotero")?.settings ?? {
		apiBaseUrl: "https://api.zotero.org",
		attachmentDownloadTimeoutMs: 120_000,
		maxConsistencyRetries: 4,
		maxRecordsPerBatch: 500,
		maxSnapshotRecords: 100_000,
		requestTimeoutMs: 30_000,
		downloadPdfs: true,
	};
	const source = (
		key: string,
		groupId: string,
		overrides: Partial<Extract<(typeof config.sources)[number], {provider: "zotero"}>> = {},
	): (typeof config.sources)[number] => ({
		key,
		provider: "zotero",
		groupId,
		apiKey: "source-configuration-test-key",
		enabled: true,
		writebackEnabled: true,
		settings,
		...overrides,
	});

	try {
		await database
			.delete(sourceConnection)
			.where(inArray(sourceConnection.key, testKeys));

		// Two sources may both allow writeback. Records pick their own targets.
		await reconcileConfiguredSources(database, [
			source(primaryKey, "900000001"),
			source(secondaryKey, "900000002"),
		]);
		let rows = await database
			.select()
			.from(sourceConnection)
			.where(inArray(sourceConnection.key, testKeys));
		assert(rows.length === 2, "Configured sources were not created");
		assert(
			rows.every(
				(row) =>
					row.status === "active" && !("defaultWriteback" in row),
			),
			"Two writeback-enabled sources were not both saved as active without a default flag",
		);

		await database
			.update(sourceConnection)
			.set({ syncCursor: { libraryVersion: 41 } })
			.where(eq(sourceConnection.key, primaryKey));
		await Promise.all([
			reconcileConfiguredSources(database, [
				source(primaryKey, "900000001"),
				source(secondaryKey, "900000002"),
			]),
			reconcileConfiguredSources(database, [
				source(primaryKey, "900000001"),
				source(secondaryKey, "900000002"),
			]),
		]);
		await reconcileConfiguredSources(database, [
			source(primaryKey, "900000001"),
			source(secondaryKey, "900000002", { enabled: false }),
		]);
		rows = await database
			.select()
			.from(sourceConnection)
			.where(inArray(sourceConnection.key, testKeys));
		const primary = rows.find((row) => row.key === primaryKey);
		const secondary = rows.find((row) => row.key === secondaryKey);
		assert(
			(primary?.syncCursor as { libraryVersion?: number }).libraryVersion ===
				41,
			"Reconciliation replaced the saved Zotero cursor",
		);
		assert(
			secondary?.status === "paused",
			"Repeated reconciliation did not apply the exact manifest state",
		);

		await reconcileConfiguredSources(database, [
			source(primaryKey, "900000001"),
		]);
		const [removed] = await database
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, secondaryKey));
		assert(
			removed?.status === "removed",
			"An omitted source was not removed cleanly",
		);

		let conflict: unknown;
		try {
			await reconcileConfiguredSources(database, [
				source(primaryKey, "900000099"),
			]);
		} catch (error) {
			conflict = error;
		}
		assert(
			conflict instanceof SourceConfigurationConflictError,
			"Changing a source key to a different Zotero group was not rejected",
		);

		console.log(
			JSON.stringify({
				concurrentReconciliation: "passed",
				cursorPreserved: true,
				identityConflictRejected: true,
				omittedSourceRemoved: true,
			}, null, 2),
		);
	} finally {
		await reconcileConfiguredSources(database, config.sources);
		await database
			.delete(sourceConnection)
			.where(inArray(sourceConnection.key, testKeys));
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
