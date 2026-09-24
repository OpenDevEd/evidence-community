import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	collectionIdentity,
	itemDraft,
	itemFileDraft,
	itemIdentity,
	sourceConnection,
	sourceFileCleanup,
	sourceRecordIssue,
	sourceSyncState,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, sql } from "drizzle-orm";

import { loadLibraryConfig } from "../src/config/library-config/source";
import type { Database } from "../src/db/database-schema";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { itemFilePublication } from "../src/db/schema/source";
import { item } from "../src/db/schema/tables/item";
import { RevisionAwareMeilisearchFactory } from "../src/lib/meilisearch-factory";
import {
	drainSearchOutbox,
	ensureSearchIndex,
} from "../src/lib/search-index/consumer";
import { runSourceConnection } from "../src/lib/source-ingestion/orchestrator";
import { createSourceSyncRuntime } from "../src/lib/source-ingestion/runtime";
import {
	ZOTERO_PLAYGROUND,
	ZOTERO_PLAYGROUND_PUBLISHED_PDF_TOKENS,
	ZOTERO_PLAYGROUND_UNPUBLISHED_PDF_TOKEN,
	ZoteroPlaygroundSeeder,
} from "./seedZoteroPlayground";

export const LIVE_ZOTERO_CONNECTION_KEY = "zotero-openscholar-test";
const PUBLISHED_PARENT_ID = "published-report";
const PUBLISHED_PDF_ID = "published-report-pdf";
const UNPUBLISHED_PARENT_ID = "unpublished-article";
const UNPUBLISHED_PDF_ID = "unpublished-control-pdf";
const METADATA_ONLY_ID = "metadata-only-webpage";
const PUBLISHED_PDF_TOKEN = ZOTERO_PLAYGROUND_PUBLISHED_PDF_TOKENS[0];
const usage =
	"Usage: npm run test:zotero-live -- --confirm-group 6632364 --confirm-local-writes";

type LiveVerifierCommand = {
	confirmGroup: string;
	confirmLocalWrites: true;
};

type ExpectedConnection = {
	externalScopeKey: string | null;
	key: string;
	provider: string;
	scopeKind: string;
	status: string;
};

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export function parseLiveVerifierCommand(args: string[]): LiveVerifierCommand {
	let confirmGroup: string | null = null;
	let confirmLocalWrites = false;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--confirm-group") {
			confirmGroup = args[index + 1] ?? null;
			index += 1;
			continue;
		}
		if (args[index] === "--confirm-local-writes") {
			confirmLocalWrites = true;
			continue;
		}
		throw new Error(usage);
	}
	if (
		confirmGroup !== ZOTERO_PLAYGROUND.groupId ||
		!confirmLocalWrites
	) {
		throw new Error(usage);
	}
	return { confirmGroup, confirmLocalWrites: true };
}

export function assertLoopbackServiceUrl(label: string, value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label} must be a valid local URL`);
	}
	if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
		throw new Error(
			`${label} must use localhost, 127.0.0.1, or ::1 for live verification`,
		);
	}
	return url;
}

export function assertLiveZoteroConnection(
	connection: ExpectedConnection | undefined,
) {
	assert(connection, `Source connection ${LIVE_ZOTERO_CONNECTION_KEY} is missing`);
	assert(
		connection.key === LIVE_ZOTERO_CONNECTION_KEY &&
			connection.provider === "zotero" &&
			connection.scopeKind === "group" &&
			connection.externalScopeKey === ZOTERO_PLAYGROUND.groupId,
		`Source connection ${LIVE_ZOTERO_CONNECTION_KEY} must be the Zotero group ${ZOTERO_PLAYGROUND.groupId}`,
	);
	assert(
		connection.status === "active",
		`Source connection ${LIVE_ZOTERO_CONNECTION_KEY} must be active`,
	);
}

async function fixtureIdentityMap(
	database: Database,
	remoteKeys: string[],
	table: typeof itemIdentity | typeof collectionIdentity,
) {
	const rows = await database
		.select({ key: table.key, sourceRecordKey: table.sourceRecordKey })
		.from(table)
		.where(
			and(
				eq(table.sourceConnectionKey, LIVE_ZOTERO_CONNECTION_KEY),
				inArray(table.sourceRecordKey, remoteKeys),
			),
		);
	assert(
		rows.length === remoteKeys.length,
		`Expected ${remoteKeys.length} fixture identities, found ${rows.length}`,
	);
	return new Map<string, string>(
		rows.map((row) => [row.sourceRecordKey, row.key]),
	);
}

async function countRows(
	database: Database,
	table:
		| typeof itemDraft
		| typeof itemFileDraft
		| typeof sourceFileCleanup
		| typeof sourceRecordIssue,
) {
	const [result] = await database
		.select({ count: sql<number>`count(*)::int` })
		.from(table)
		.where(eq(table.sourceConnectionKey, LIVE_ZOTERO_CONNECTION_KEY));
	return result?.count ?? 0;
}

async function verifyPipeline() {
	parseLiveVerifierCommand(process.argv.slice(2));
	const config = await loadLibraryConfig();
	assertLoopbackServiceUrl("Database URL", config.services.database.url);
	assertLoopbackServiceUrl("Storage URL", config.services.storage.url);
	assertLoopbackServiceUrl("Search URL", config.services.search.host);

	const databaseResource = createPostgresDatabaseResource(
		config.services.database.url,
	);
	const database = databaseResource.database;
	try {
		const [connection] = await database
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, LIVE_ZOTERO_CONNECTION_KEY))
			.limit(1);
		assertLiveZoteroConnection(connection);

		const runtime = createSourceSyncRuntime(config, database);
		const apiKey = await runtime.credentialResolver(connection.key);
		assert(
			apiKey,
			`Source ${connection.key} has no API key in the library configuration`,
		);
		const publishTag = config.content.tags.publish[0];
		assert(publishTag, "The active configuration needs a PDF publication tag");

		const seed = await new ZoteroPlaygroundSeeder({
			apiKey,
			groupId: ZOTERO_PLAYGROUND.groupId,
			publishTag,
		}).seed();
		const sync = await runSourceConnection({
			credentialResolver: runtime.credentialResolver,
			database,
			registry: runtime.registry,
			sourceConnectionKey: LIVE_ZOTERO_CONNECTION_KEY,
			workerId: `zotero-live-verifier:${process.pid}`,
		});

		const search = await new RevisionAwareMeilisearchFactory().get({
			configuration: config.services.search,
			revision: config.revision,
			updatedAt: config.updatedAt,
		});
		await ensureSearchIndex(search);
		const indexedBatches = await drainSearchOutbox({
				publication: config,
			batchClient: search.client.batches,
			database,
			index: search.index,
			maxEvents: 100_000,
			workerId: `zotero-live-verifier-index:${process.pid}`,
		});

		const itemRemoteKeys = Object.values(seed.fixtureItems);
		const collectionRemoteKeys = Object.values(seed.collections);
		const items = await fixtureIdentityMap(
			database,
			itemRemoteKeys,
			itemIdentity,
		);
		await fixtureIdentityMap(
			database,
			collectionRemoteKeys,
			collectionIdentity,
		);

		const publishedAttachmentKey = items.get(
			seed.fixtureItems[PUBLISHED_PDF_ID]!,
		);
		const unpublishedAttachmentKey = items.get(
			seed.fixtureItems[UNPUBLISHED_PDF_ID]!,
		);
		assert(publishedAttachmentKey, "Published attachment identity is missing");
		assert(
			unpublishedAttachmentKey,
			"Unpublished attachment identity is missing",
		);

		const publications = await database
			.select()
			.from(itemFilePublication)
			.where(
				inArray(itemFilePublication.itemKey, [
					publishedAttachmentKey,
					unpublishedAttachmentKey,
				]),
			);
		assert(
			publications.length === 1 &&
				publications[0]?.itemKey === publishedAttachmentKey,
			"Exactly the publish-tagged fixture PDF must be public",
		);
		const publication = publications[0]!;

		const fixtureFiles = await database
			.select({
				fullTextPDF: item.fullTextPDF,
				key: item.key,
				parentItem: item.parentItem,
				url: item.url,
			})
			.from(item)
			.where(
				inArray(item.key, [
					publishedAttachmentKey,
					unpublishedAttachmentKey,
				]),
			);
		const publishedFile = fixtureFiles.find(
			(row) => row.key === publishedAttachmentKey,
		);
		const unpublishedFile = fixtureFiles.find(
			(row) => row.key === unpublishedAttachmentKey,
		);
		assert(
			publishedFile?.url === publication.publicUrl &&
				publishedFile.fullTextPDF?.includes(PUBLISHED_PDF_TOKEN),
			"Published fixture PDF metadata or extracted text is incomplete",
		);
		assert(
			unpublishedFile?.url === null && unpublishedFile.fullTextPDF === null,
			"The untagged fixture PDF must remain unpublished",
		);

		const verificationNonce = String(Date.now());
		const pdfUrl = assertLoopbackServiceUrl(
			"Published PDF URL",
			publication.publicUrl,
		);
		const coverUrl = assertLoopbackServiceUrl(
			"Published cover URL",
			publication.coverPublicUrl,
		);
		pdfUrl.searchParams.set("verify", verificationNonce);
		coverUrl.searchParams.set("verify", verificationNonce);
		const [pdfResponse, coverResponse] = await Promise.all([
			fetch(pdfUrl, {
				cache: "no-store",
			}),
			fetch(coverUrl, {
				cache: "no-store",
			}),
		]);
		assert(pdfResponse.ok, `Published PDF returned HTTP ${pdfResponse.status}`);
		assert(
			pdfResponse.headers.get("content-type")?.includes("application/pdf"),
			"Published PDF has the wrong content type",
		);
		assert(
			coverResponse.ok &&
				coverResponse.headers.get("content-type")?.includes("image/png"),
			"Published cover is unavailable or has the wrong content type",
		);

		const parentFixtureIds = [
			PUBLISHED_PARENT_ID,
			UNPUBLISHED_PARENT_ID,
			METADATA_ONLY_ID,
		] as const;
		const documents = await Promise.all(
			parentFixtureIds.map(async (fixtureId) => {
				const remoteKey = seed.fixtureItems[fixtureId]!;
				const key = items.get(remoteKey);
				assert(key, `Canonical identity is missing for ${fixtureId}`);
				return search.index.getDocument<Record<string, unknown>>(key);
			}),
		);
		for (const [index, document] of documents.entries()) {
			const remoteKey = seed.fixtureItems[parentFixtureIds[index]!]!;
			assert(
				document.provider === "zotero" &&
					document.sourceConnectionKey === LIVE_ZOTERO_CONNECTION_KEY &&
					document.sourceRecordKey === remoteKey,
				`Search source identity is incorrect for ${remoteKey}`,
			);
		}
		assert(
			JSON.stringify(documents[0]).includes(PUBLISHED_PDF_TOKEN),
			"Published PDF text is missing from the parent search document",
		);
		assert(
			!JSON.stringify(documents[1]).includes(
				ZOTERO_PLAYGROUND_UNPUBLISHED_PDF_TOKEN,
			),
			"Unpublished PDF text leaked into the search document",
		);

		const [state] = await database
			.select()
			.from(sourceSyncState)
			.where(
				eq(
					sourceSyncState.sourceConnectionKey,
					LIVE_ZOTERO_CONNECTION_KEY,
				),
			)
			.limit(1);
		assert(
			state?.lastSuccessAt &&
				state.consecutiveFailures === 0 &&
				state.lastError === null &&
				state.leaseOwner === null &&
				state.activeRunId === null,
			"Source synchronization health or lease state is not clean",
		);
		const [connectionAfter] = await database
			.select({ syncCursor: sourceConnection.syncCursor })
			.from(sourceConnection)
			.where(eq(sourceConnection.key, LIVE_ZOTERO_CONNECTION_KEY))
			.limit(1);
		assert(
			typeof connectionAfter?.syncCursor.libraryVersion === "number",
			"Zotero library version was not persisted",
		);
		const [drafts, fileDrafts, cleanup, issues] = await Promise.all([
			countRows(database, itemDraft),
			countRows(database, itemFileDraft),
			countRows(database, sourceFileCleanup),
			countRows(database, sourceRecordIssue),
		]);
		assert(drafts === 0, "Imported item drafts were created");
		assert(fileDrafts === 0, "Imported file drafts were created");
		assert(cleanup === 0, "Source file cleanup work remains pending");
		assert(issues === 0, "Source record issues remain unresolved");

		console.log(
			JSON.stringify(
				{
					collectionsVerified: collectionRemoteKeys.length,
					cursor: connectionAfter.syncCursor,
					indexedEvents: indexedBatches.reduce(
						(total, batch) => total + batch.eventIds.length,
						0,
					),
					itemsVerified: itemRemoteKeys.length,
					publishedPdf: publication.publicUrl,
					seed,
					sync,
				},
				null,
				2,
			),
		);
	} finally {
		await databaseResource.dispose();
	}
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	verifyPipeline().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
