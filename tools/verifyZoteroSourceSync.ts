import { createServer, type ServerResponse } from "node:http";

import {
	collectionIdentity,
	itemIdentity,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { sourceSnapshot } from "../src/db/schema/source";
import { collection } from "../src/db/schema/tables/collection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import { tag } from "../src/db/schema/tables/tag";
import { createEnvironmentCredentialResolver } from "../src/lib/source-ingestion/credentials";
import { syncZoteroSource } from "../src/lib/source-ingestion/zotero/sync";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

const connectionKey = "zotero-local-e2e";
const tagNames = ["evidence", "publishPDF"];

type RemoteRecord = {
	data: Record<string, unknown>;
	key: string;
	links?: Record<string, { href: string }>;
	meta?: Record<string, unknown>;
	version: number;
};

type RemoteState = {
	collections: Map<string, RemoteRecord>;
	deletedCollections: Map<string, number>;
	deletedItems: Map<string, number>;
	driftOnItemsVersions: (() => void) | null;
	items: Map<string, RemoteRecord>;
	version: number;
};

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function json(response: ServerResponse, body: unknown, version?: number) {
	response.statusCode = 200;
	response.setHeader("content-type", "application/json");
	if (version !== undefined) {
		response.setHeader("last-modified-version", String(version));
	}
	response.end(JSON.stringify(body));
}

function changedVersions(records: Map<string, RemoteRecord>, since: number) {
	return Object.fromEntries(
		[...records.values()]
			.filter((record) => record.version > since)
			.map((record) => [record.key, record.version]),
	);
}

function requestedKeys(url: URL, field: string) {
	return (url.searchParams.get(field) ?? "").split(",").filter(Boolean);
}

function createRemoteState(): RemoteState {
	return {
		version: 10,
		driftOnItemsVersions: null,
		deletedCollections: new Map(),
		deletedItems: new Map(),
		collections: new Map([
			[
				"CCCC2345",
				{
					key: "CCCC2345",
					version: 8,
					data: {
						key: "CCCC2345",
						name: "Evidence",
						parentCollection: false,
						relations: {},
						version: 8,
					},
					meta: { numCollections: 1, numItems: 0 },
				},
			],
			[
				"DDDD2345",
				{
					key: "DDDD2345",
					version: 9,
					data: {
						key: "DDDD2345",
						name: "Reports",
						parentCollection: "CCCC2345",
						relations: {},
						version: 9,
					},
					meta: { numCollections: 0, numItems: 1 },
				},
			],
			[
				"EEEE2345",
				{
					key: "EEEE2345",
					version: 10,
					data: {
						deleted: true,
						key: "EEEE2345",
						name: "Trashed collection",
						parentCollection: false,
						relations: {},
						version: 10,
					},
					meta: { numCollections: 0, numItems: 1 },
				},
			],
			[
				"RRRR2345",
				{
					key: "RRRR2345",
					version: 10,
					data: {
						key: "RRRR2345",
						name: "Movable root",
						parentCollection: false,
						relations: {},
						version: 10,
					},
					meta: { numCollections: 1, numItems: 0 },
				},
			],
			[
				"KKKK2345",
				{
					key: "KKKK2345",
					version: 10,
					data: {
						key: "KKKK2345",
						name: "Unchanged child collection",
						parentCollection: "RRRR2345",
						relations: {},
						version: 10,
					},
					meta: { numCollections: 0, numItems: 1 },
				},
			],
		]),
		items: new Map([
			[
				"AAAA2345",
				{
					key: "AAAA2345",
					version: 10,
					links: {
						alternate: {
							href: "https://www.zotero.org/groups/999/items/AAAA2345",
						},
					},
					data: {
						abstractNote: "Initial abstract",
						collections: ["DDDD2345"],
						creators: [
							{
								creatorType: "author",
								firstName: "Ada",
								lastName: "Lovelace",
							},
						],
						dateAdded: "2026-07-20T12:00:00Z",
						dateModified: "2026-07-29T12:00:00Z",
						itemType: "document",
						key: "AAAA2345",
						relations: {},
						tags: [{ tag: "evidence" }],
						title: "Initial report",
						version: 10,
					},
				},
			],
			[
				"BBBB2345",
				{
					key: "BBBB2345",
					version: 10,
					data: {
						charset: "utf-8",
						collections: [],
						contentType: "application/pdf",
						dateAdded: "2026-07-20T12:01:00Z",
						dateModified: "2026-07-29T12:01:00Z",
						filename: "report.pdf",
						inPublications: false,
						itemType: "attachment",
						key: "BBBB2345",
						lastRead: "2026-07-29T12:30:00Z",
						linkMode: "imported_file",
						md5: "abc123",
						mtime: "1753786800000",
						note: "<p>Attachment note</p>",
						parentItem: "AAAA2345",
						path: "storage:report.pdf",
						relations: {},
						tags: [{ tag: "publishPDF" }],
						title: "Report PDF",
						version: 10,
					},
				},
			],
			[
				"CHILD234",
				{
					key: "CHILD234",
					version: 10,
					data: {
						collections: [],
						itemType: "note",
						key: "CHILD234",
						note: "<p>Child of trash</p>",
						parentItem: "TRASH234",
						relations: {},
						tags: [],
						version: 10,
					},
				},
			],
			[
				"FFFF2345",
				{
					key: "FFFF2345",
					version: 10,
					data: {
						collections: ["EEEE2345"],
						itemType: "document",
						key: "FFFF2345",
						relations: {},
						tags: [],
						title: "Item retained from trashed collection",
						version: 10,
					},
				},
			],
			[
				"IIII2345",
				{
					key: "IIII2345",
					version: 10,
					data: {
						collections: ["KKKK2345"],
						itemType: "document",
						key: "IIII2345",
						relations: {},
						tags: [],
						title: "Member of unchanged child collection",
						version: 10,
					},
				},
			],
			[
				"MOVE2345",
				{
					key: "MOVE2345",
					version: 10,
					data: {
						collections: [],
						itemType: "note",
						key: "MOVE2345",
						note: "<p>Move me safely</p>",
						parentItem: "PPPP2345",
						relations: {},
						tags: [],
						version: 10,
					},
				},
			],
			[
				"PPPP2345",
				{
					key: "PPPP2345",
					version: 10,
					data: {
						collections: [],
						itemType: "document",
						key: "PPPP2345",
						relations: {},
						tags: [],
						title: "Old parent",
						version: 10,
					},
				},
			],
			[
				"QQQQ2345",
				{
					key: "QQQQ2345",
					version: 10,
					data: {
						collections: [],
						itemType: "document",
						key: "QQQQ2345",
						relations: {},
						tags: [],
						title: "New parent",
						version: 10,
					},
				},
			],
			[
				"TRASH234",
				{
					key: "TRASH234",
					version: 10,
					data: {
						collections: [],
						deleted: 1,
						itemType: "document",
						key: "TRASH234",
						relations: {},
						tags: [],
						title: "Trashed parent",
						version: 10,
					},
				},
			],
			[
				"ZZZZ2345",
				{
					key: "ZZZZ2345",
					version: 10,
					data: {
						annotationAuthorName: "Ada",
						annotationColor: "#ffd400",
						annotationComment: "Important",
						annotationPageLabel: "4",
						annotationPosition:
							'{"pageIndex":3,"rects":[[1,2,3,4]]}',
						annotationSortIndex: "00004|000001|00000",
						annotationText: "Evidence",
						annotationType: "highlight",
						collections: [],
						itemType: "annotation",
						key: "ZZZZ2345",
						parentItem: "BBBB2345",
						relations: {},
						tags: [],
						version: 10,
					},
				},
			],
		]),
	};
}

async function cleanup(
	database: ReturnType<typeof createPostgresDatabaseResource>["database"],
) {
	const itemIdentities = await database
		.select({ key: itemIdentity.key })
		.from(itemIdentity)
		.where(eq(itemIdentity.sourceConnectionKey, connectionKey));
	const itemKeys = itemIdentities.map(({ key }) => key);
	if (itemKeys.length > 0) {
		await database
			.delete(outbox)
			.where(inArray(outbox.entityKey, itemKeys));
		await database
			.delete(itemToCollection)
			.where(inArray(itemToCollection.itemKey, itemKeys));
		await database
			.delete(itemToTag)
			.where(inArray(itemToTag.itemKey, itemKeys));
		await database.delete(item).where(inArray(item.key, itemKeys));
		await database
			.delete(itemIdentity)
			.where(inArray(itemIdentity.key, itemKeys));
	}
	const collectionIdentities = await database
		.select({ key: collectionIdentity.key })
		.from(collectionIdentity)
		.where(eq(collectionIdentity.sourceConnectionKey, connectionKey));
	const collectionKeys = collectionIdentities.map(({ key }) => key);
	if (collectionKeys.length > 0) {
		await database
			.delete(outbox)
			.where(inArray(outbox.entityKey, collectionKeys));
		await database
			.delete(collection)
			.where(inArray(collection.key, collectionKeys));
		await database
			.delete(collectionIdentity)
			.where(inArray(collectionIdentity.key, collectionKeys));
	}
	await database
		.delete(sourceConnection)
		.where(eq(sourceConnection.key, connectionKey));
	await database.delete(tag).where(inArray(tag.name, tagNames));
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const database = resource.database;
	const remote = createRemoteState();
	const apiKey = "local-zotero-key";
	process.env.LOCAL_ZOTERO_API_KEY = apiKey;

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (request.headers["zotero-api-version"] !== "3") {
			response.statusCode = 400;
			response.end("missing api version");
			return;
		}
		if (request.headers["zotero-api-key"] !== apiKey) {
			response.statusCode = 403;
			response.end("bad key");
			return;
		}
		if (url.pathname === "/keys/current") {
			json(response, {
				access: { groups: { all: { library: true } } },
				userID: 1,
				username: "local",
			});
			return;
		}
		if (!url.pathname.startsWith("/groups/999/")) {
			response.statusCode = 404;
			response.end("not found");
			return;
		}
		const since = Number(url.searchParams.get("since") ?? 0);
		if (
			url.pathname === "/groups/999/collections" &&
			url.searchParams.get("format") === "versions"
		) {
			json(
				response,
				changedVersions(remote.collections, since),
				remote.version,
			);
			return;
		}
		if (
			url.pathname === "/groups/999/items" &&
			url.searchParams.get("format") === "versions"
		) {
			const drift = remote.driftOnItemsVersions;
			remote.driftOnItemsVersions = null;
			drift?.();
			json(
				response,
				changedVersions(remote.items, since),
				remote.version,
			);
			return;
		}
		if (url.pathname === "/groups/999/deleted") {
			json(
				response,
				{
					collections: [...remote.deletedCollections]
						.filter(([, version]) => version > since)
						.map(([key]) => key),
					items: [...remote.deletedItems]
						.filter(([, version]) => version > since)
						.map(([key]) => key),
					searches: [],
					tags: [],
				},
				remote.version,
			);
			return;
		}
		if (url.pathname === "/groups/999/collections") {
			json(
				response,
				requestedKeys(url, "collectionKey").flatMap((key) => {
					const record = remote.collections.get(key);
					return record ? [record] : [];
				}),
				remote.version,
			);
			return;
		}
		if (url.pathname === "/groups/999/items") {
			json(
				response,
				requestedKeys(url, "itemKey").flatMap((key) => {
					const record = remote.items.get(key);
					return record ? [record] : [];
				}),
				remote.version,
			);
			return;
		}
		response.statusCode = 404;
		response.end("not found");
	});

	await new Promise<void>((resolve) =>
		server.listen(0, "127.0.0.1", resolve),
	);
	const address = server.address();
	assert(address && typeof address !== "string", "Server has no address");

	try {
		await cleanup(database);
		await database.insert(sourceConnection).values({
			key: connectionKey,
			provider: "zotero",
			scopeKind: "group",
			externalScopeKey: "999",
			credentialRef: "env:LOCAL_ZOTERO_API_KEY",
			config: {
				apiBaseUrl: `http://127.0.0.1:${address.port}`,
				maxConsistencyRetries: 4,
				maxRecordsPerBatch: 1,
				requestTimeoutMs: 5_000,
			},
		});

		let failAttachmentOnce = true;
		let interrupted = false;
		try {
			await syncZoteroSource({
				database,
				sourceConnectionKey: connectionKey,
				credentialResolver: createEnvironmentCredentialResolver(),
				attachmentProcessor: async () => {
					if (failAttachmentOnce) {
						failAttachmentOnce = false;
						throw new Error("simulated attachment interruption");
					}
					return null;
				},
				sleep: async () => {},
			});
		} catch (error) {
			interrupted =
				error instanceof Error &&
				error.message === "simulated attachment interruption";
		}
		assert(interrupted, "Checkpoint interruption was not propagated");
		const [pendingConnection] = await database
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, connectionKey));
		const pendingCursor = pendingConnection?.syncCursor as {
			libraryVersion?: number;
			pending?: {
				offset?: number;
				snapshotSince?: number;
				targetVersion?: number;
			};
			softTrashedCollectionKeys?: string[];
			softTrashedItemKeys?: string[];
		};
		assert(
			pendingCursor.libraryVersion === 0 &&
				pendingCursor.pending?.offset === 5 &&
				pendingCursor.pending.snapshotSince === 0 &&
				pendingCursor.pending.targetVersion === 10,
			"Partial Zotero sync did not persist its checkpoint",
		);

		const initial = await syncZoteroSource({
			database,
			sourceConnectionKey: connectionKey,
			credentialResolver: createEnvironmentCredentialResolver(),
			attachmentProcessor: async (record) => ({
				charset: String(record.data.charset),
				contentType: String(record.data.contentType),
				coverHeight: null,
				coverUrl: null,
				coverWidth: null,
				filename: String(record.data.filename),
				fullText: null,
				linkMode: String(record.data.linkMode),
				managedPublication: null,
				md5: String(record.data.md5),
				mtime: String(record.data.mtime),
				url: "https://storage.example.org/report.pdf",
			}),
			sleep: async () => {},
		});
		assert(
			initial.records === 15 &&
				initial.batches === 10 &&
				initial.targetVersion === 10,
			"Zotero sync did not resume from its checkpoint",
		);

		const [
			parentIdentity,
			annotationIdentity,
			retainedItemIdentity,
			attachmentIdentity,
			childCollectionIdentity,
		] = await Promise.all([
			database
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, connectionKey),
						eq(itemIdentity.sourceRecordKey, "AAAA2345"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, connectionKey),
						eq(itemIdentity.sourceRecordKey, "ZZZZ2345"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, connectionKey),
						eq(itemIdentity.sourceRecordKey, "FFFF2345"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, connectionKey),
						eq(itemIdentity.sourceRecordKey, "BBBB2345"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(collectionIdentity)
				.where(
					and(
						eq(
							collectionIdentity.sourceConnectionKey,
							connectionKey,
						),
						eq(collectionIdentity.sourceRecordKey, "DDDD2345"),
					),
				)
				.then((rows) => rows[0]),
		]);
		assert(
			parentIdentity &&
				attachmentIdentity &&
				annotationIdentity &&
				retainedItemIdentity &&
				childCollectionIdentity,
			"Zotero identities were not created",
		);
		const [
			parent,
			attachment,
			annotation,
			membership,
			trashedMembership,
			snapshot,
			trashedParentIdentity,
			trashedChildIdentity,
			trashedCollectionIdentity,
		] = await Promise.all([
			database
				.select()
				.from(item)
				.where(eq(item.key, parentIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(item)
				.where(eq(item.key, attachmentIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(item)
				.where(eq(item.key, annotationIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemToCollection)
				.where(
					and(
						eq(itemToCollection.itemKey, parentIdentity.key),
						eq(
							itemToCollection.collectionKey,
							childCollectionIdentity.key,
						),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemToCollection)
				.where(eq(itemToCollection.itemKey, retainedItemIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(sourceSnapshot)
				.where(eq(sourceSnapshot.itemKey, parentIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, connectionKey),
						eq(itemIdentity.sourceRecordKey, "TRASH234"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, connectionKey),
						eq(itemIdentity.sourceRecordKey, "CHILD234"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(collectionIdentity)
				.where(
					and(
						eq(
							collectionIdentity.sourceConnectionKey,
							connectionKey,
						),
						eq(collectionIdentity.sourceRecordKey, "EEEE2345"),
					),
				)
				.then((rows) => rows[0]),
		]);
		assert(
			parent?.title === "Initial report" &&
				attachment?.parentItem === parentIdentity.key &&
				attachment.note === "<p>Attachment note</p>" &&
				attachment.url === "https://storage.example.org/report.pdf" &&
				annotation?.parentItem === attachmentIdentity.key &&
				annotation.annotationType === "highlight" &&
				annotation.annotationText === "Evidence" &&
				membership &&
				!trashedMembership &&
				snapshot?.remoteVersion === "10",
			`Zotero records were not mapped canonically: ${JSON.stringify({
				annotationParent: annotation?.parentItem,
				annotationText: annotation?.annotationText,
				annotationType: annotation?.annotationType,
				attachmentNote: attachment?.note,
				attachmentParent: attachment?.parentItem,
				attachmentUrl: attachment?.url,
				expectedAnnotationParent: attachmentIdentity.key,
				expectedAttachmentParent: parentIdentity.key,
				hasMembership: Boolean(membership),
				hasTrashedMembership: Boolean(trashedMembership),
				parentTitle: parent?.title,
				snapshotVersion: snapshot?.remoteVersion,
			})}`,
		);
		assert(
			!trashedParentIdentity &&
				!trashedChildIdentity &&
				!trashedCollectionIdentity,
			"Trashed Zotero subtrees were imported as active records",
		);

		const syncedEntityKeys = [
			parentIdentity.key,
			attachmentIdentity.key,
			annotationIdentity.key,
			retainedItemIdentity.key,
			childCollectionIdentity.key,
		];
		const eventsBeforeReplay = await database
			.select()
			.from(outbox)
			.where(inArray(outbox.entityKey, syncedEntityKeys));
		const replay = await syncZoteroSource({
			database,
			sourceConnectionKey: connectionKey,
			credentialResolver: createEnvironmentCredentialResolver(),
			sleep: async () => {},
		});
		const eventsAfterReplay = await database
			.select()
			.from(outbox)
			.where(inArray(outbox.entityKey, syncedEntityKeys));
		assert(
			replay.records === 0 &&
				eventsAfterReplay.length === eventsBeforeReplay.length,
			"Exact Zotero replay emitted canonical changes",
		);

		remote.version = 11;
		const movedRemote = remote.items.get("MOVE2345")!;
		movedRemote.version = 11;
		movedRemote.data = {
			...movedRemote.data,
			parentItem: "QQQQ2345",
			version: 11,
		};
		const oldParentRemote = remote.items.get("PPPP2345")!;
		oldParentRemote.version = 11;
		oldParentRemote.data = {
			...oldParentRemote.data,
			deleted: true,
			version: 11,
		};
		const changedMemberRemote = remote.items.get("IIII2345")!;
		changedMemberRemote.version = 11;
		changedMemberRemote.data = {
			...changedMemberRemote.data,
			title: "Changed while its collection root was trashed",
			version: 11,
		};
		const trashedRootRemote = remote.collections.get("RRRR2345")!;
		trashedRootRemote.version = 11;
		trashedRootRemote.data = {
			...trashedRootRemote.data,
			deleted: true,
			version: 11,
		};
		await syncZoteroSource({
			database,
			sourceConnectionKey: connectionKey,
			credentialResolver: createEnvironmentCredentialResolver(),
			sleep: async () => {},
		});
		const [
			movedIdentity,
			oldParentIdentity,
			newParentIdentity,
			memberIdentity,
			rootCollectionIdentity,
			nestedCollectionIdentity,
		] = await Promise.all([
			...["MOVE2345", "PPPP2345", "QQQQ2345", "IIII2345"].map(
				(sourceRecordKey) =>
					database
						.select()
						.from(itemIdentity)
						.where(
							and(
								eq(
									itemIdentity.sourceConnectionKey,
									connectionKey,
								),
								eq(
									itemIdentity.sourceRecordKey,
									sourceRecordKey,
								),
							),
						)
						.then((rows) => rows[0]),
			),
			...["RRRR2345", "KKKK2345"].map((sourceRecordKey) =>
				database
					.select()
					.from(collectionIdentity)
					.where(
						and(
							eq(
								collectionIdentity.sourceConnectionKey,
								connectionKey,
							),
							eq(
								collectionIdentity.sourceRecordKey,
								sourceRecordKey,
							),
						),
					)
					.then((rows) => rows[0]),
			),
		]);
		assert(
			movedIdentity &&
				oldParentIdentity &&
				newParentIdentity &&
				memberIdentity &&
				rootCollectionIdentity &&
				nestedCollectionIdentity,
			"Delta-ordering fixtures have no canonical identities",
		);
		const [
			movedItem,
			oldParent,
			changedMember,
			trashedRoot,
			trashedNestedCollection,
			staleMembership,
		] = await Promise.all([
			database
				.select()
				.from(item)
				.where(eq(item.key, movedIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(item)
				.where(eq(item.key, oldParentIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(item)
				.where(eq(item.key, memberIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(collection)
				.where(eq(collection.key, rootCollectionIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(collection)
				.where(eq(collection.key, nestedCollectionIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemToCollection)
				.where(
					and(
						eq(itemToCollection.itemKey, memberIdentity.key),
						eq(
							itemToCollection.collectionKey,
							nestedCollectionIdentity.key,
						),
					),
				)
				.then((rows) => rows[0]),
		]);
		assert(
			movedItem?.deleted === 0 &&
				movedItem.parentItem === newParentIdentity.key &&
				oldParent?.deleted === 1 &&
				changedMember?.deleted === 0 &&
				trashedRoot?.deleted === 1 &&
				trashedNestedCollection?.deleted === 1 &&
				!staleMembership,
			"Current snapshot relationships did not override stale local relationships",
		);

		remote.version = 12;
		changedMemberRemote.version = 12;
		changedMemberRemote.data = {
			...changedMemberRemote.data,
			title: "Changed after its collection root was already trashed",
			version: 12,
		};
		await syncZoteroSource({
			database,
			sourceConnectionKey: connectionKey,
			credentialResolver: createEnvironmentCredentialResolver(),
			sleep: async () => {},
		});
		const [changedAfterTrash, membershipAfterTrash] = await Promise.all([
			database
				.select()
				.from(item)
				.where(eq(item.key, memberIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemToCollection)
				.where(
					and(
						eq(itemToCollection.itemKey, memberIdentity.key),
						eq(
							itemToCollection.collectionKey,
							nestedCollectionIdentity.key,
						),
					),
				)
				.then((rows) => rows[0]),
		]);
		assert(
			changedAfterTrash?.title ===
				"Changed after its collection root was already trashed" &&
				!membershipAfterTrash,
			"Durable soft-trash state did not filter a later membership delta",
		);

		remote.version = 13;
		const parentRemote = remote.items.get("AAAA2345")!;
		parentRemote.version = 13;
		parentRemote.data = {
			...parentRemote.data,
			title: "Updated report",
			version: 13,
		};
		remote.items.delete("BBBB2345");
		remote.deletedItems.set("BBBB2345", 13);
		await syncZoteroSource({
			database,
			sourceConnectionKey: connectionKey,
			credentialResolver: createEnvironmentCredentialResolver(),
			sleep: async () => {},
		});
		const [updatedParent, deletedAttachment, deletedAnnotation] =
			await Promise.all([
				database
					.select()
					.from(item)
					.where(eq(item.key, parentIdentity.key))
					.then((rows) => rows[0]),
				database
					.select()
					.from(item)
					.where(eq(item.key, attachmentIdentity.key))
					.then((rows) => rows[0]),
				database
					.select()
					.from(item)
					.where(eq(item.key, annotationIdentity.key))
					.then((rows) => rows[0]),
			]);
		assert(
			updatedParent?.title === "Updated report" &&
				deletedAttachment?.deleted === 1 &&
				deletedAnnotation?.deleted === 1,
			"Incremental update and descendant deletion were not applied",
		);

		remote.version = 14;
		parentRemote.version = 14;
		parentRemote.data = {
			...parentRemote.data,
			title: "Version fourteen",
			version: 14,
		};
		remote.driftOnItemsVersions = () => {
			remote.version = 15;
			parentRemote.version = 15;
			parentRemote.data = {
				...parentRemote.data,
				title: "Stable after drift",
				version: 15,
			};
		};
		const drifted = await syncZoteroSource({
			database,
			sourceConnectionKey: connectionKey,
			credentialResolver: createEnvironmentCredentialResolver(),
			sleep: async () => {},
		});
		const [stableParent, finalConnection] = await Promise.all([
			database
				.select()
				.from(item)
				.where(eq(item.key, parentIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(sourceConnection)
				.where(eq(sourceConnection.key, connectionKey))
				.then((rows) => rows[0]),
		]);
		const finalCursor = finalConnection?.syncCursor as {
			libraryVersion?: number;
			softTrashedCollectionKeys?: string[];
			softTrashedItemKeys?: string[];
		};
		assert(
			drifted.targetVersion === 15 &&
				stableParent?.title === "Stable after drift" &&
				finalCursor.libraryVersion === 15 &&
				finalCursor.softTrashedCollectionKeys?.join(",") ===
					"EEEE2345,KKKK2345,RRRR2345" &&
				finalCursor.softTrashedItemKeys?.join(",") ===
					"CHILD234,PPPP2345,TRASH234",
			`Concurrent Zotero change did not restart from a stable snapshot: ${JSON.stringify(
				{
					cursor: finalConnection?.syncCursor,
					targetVersion: drifted.targetVersion,
					title: stableParent?.title,
				},
			)}`,
		);

		remote.version = 16;
		const restoredParentRemote = remote.items.get("TRASH234")!;
		restoredParentRemote.version = 16;
		restoredParentRemote.data = {
			...restoredParentRemote.data,
			deleted: false,
			version: 16,
		};
		const restoredCollectionRemote = remote.collections.get("EEEE2345")!;
		restoredCollectionRemote.version = 16;
		restoredCollectionRemote.data = {
			...restoredCollectionRemote.data,
			deleted: false,
			version: 16,
		};
		oldParentRemote.version = 16;
		oldParentRemote.data = {
			...oldParentRemote.data,
			deleted: false,
			version: 16,
		};
		trashedRootRemote.version = 16;
		trashedRootRemote.data = {
			...trashedRootRemote.data,
			deleted: false,
			version: 16,
		};
		const restored = await syncZoteroSource({
			database,
			sourceConnectionKey: connectionKey,
			credentialResolver: createEnvironmentCredentialResolver(),
			sleep: async () => {},
		});
		const [
			restoredParentIdentity,
			restoredChildIdentity,
			restoredCollectionIdentity,
			restoredConnection,
		] = await Promise.all([
			database
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, connectionKey),
						eq(itemIdentity.sourceRecordKey, "TRASH234"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, connectionKey),
						eq(itemIdentity.sourceRecordKey, "CHILD234"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(collectionIdentity)
				.where(
					and(
						eq(
							collectionIdentity.sourceConnectionKey,
							connectionKey,
						),
						eq(collectionIdentity.sourceRecordKey, "EEEE2345"),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(sourceConnection)
				.where(eq(sourceConnection.key, connectionKey))
				.then((rows) => rows[0]),
		]);
		assert(
			restoredParentIdentity &&
				restoredChildIdentity &&
				restoredCollectionIdentity,
			"Restoring a previously unseen trash subtree did not import it",
		);
		const [
			restoredChild,
			restoredMembership,
			restoredNestedCollection,
			restoredNestedMembership,
		] = await Promise.all([
			database
				.select()
				.from(item)
				.where(eq(item.key, restoredChildIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemToCollection)
				.where(
					and(
						eq(itemToCollection.itemKey, retainedItemIdentity.key),
						eq(
							itemToCollection.collectionKey,
							restoredCollectionIdentity.key,
						),
					),
				)
				.then((rows) => rows[0]),
			database
				.select()
				.from(collection)
				.where(eq(collection.key, nestedCollectionIdentity.key))
				.then((rows) => rows[0]),
			database
				.select()
				.from(itemToCollection)
				.where(
					and(
						eq(itemToCollection.itemKey, memberIdentity.key),
						eq(
							itemToCollection.collectionKey,
							nestedCollectionIdentity.key,
						),
					),
				)
				.then((rows) => rows[0]),
		]);
		const restoredCursor = restoredConnection?.syncCursor as {
			libraryVersion?: number;
			softTrashedCollectionKeys?: string[];
			softTrashedItemKeys?: string[];
		};
		assert(
			restored.targetVersion === 16 &&
				restoredChild?.parentItem === restoredParentIdentity.key &&
				Boolean(restoredMembership) &&
				restoredNestedCollection?.deleted === 0 &&
				Boolean(restoredNestedMembership) &&
				restoredCursor.libraryVersion === 16 &&
				restoredCursor.softTrashedCollectionKeys?.length === 0 &&
				restoredCursor.softTrashedItemKeys?.length === 0,
			"Restored subtree or collection membership was incomplete",
		);

		console.log(
			JSON.stringify({
				checkpointResumed: true,
				finalVersion: restored.targetVersion,
				hardDeleteApplied: deletedAttachment.deleted === 1,
				parentKey: parentIdentity.key,
				reparentPreserved: true,
				restoredTrashSubtree: true,
				staleMembershipFiltered: true,
				snapshotRestarted: true,
			}),
		);
	} finally {
		await cleanup(database);
		delete process.env.LOCAL_ZOTERO_API_KEY;
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
