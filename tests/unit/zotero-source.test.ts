import { describe, expect, it } from "vitest";

import {
	SourceCredentialNotFoundError,
	createEnvironmentCredentialResolver,
} from "@/lib/source-ingestion/credentials";
import {
	mapZoteroCollection,
	mapZoteroItem,
} from "@/lib/source-ingestion/zotero/mapper";
import {
	ZoteroApiClient,
	ZoteroApiError,
} from "@/lib/source-ingestion/zotero/client";
import {
	zoteroConnectionConfigSchema,
	zoteroCursorSchema,
	zoteroItemResponseSchema,
} from "@/lib/source-ingestion/zotero/schema";

describe("Zotero source configuration", () => {
	it("applies bounded defaults and rejects oversized batches", () => {
		expect(zoteroConnectionConfigSchema.parse({})).toMatchObject({
			apiBaseUrl: "https://api.zotero.org",
			maxConsistencyRetries: 4,
			maxRecordsPerBatch: 500,
			maxSnapshotRecords: 100_000,
			requestTimeoutMs: 30_000,
		});
		expect(
			zoteroConnectionConfigSchema.safeParse({
				maxRecordsPerBatch: 1_001,
			}).success,
		).toBe(false);
	});

	it("resolves explicit environment references only", async () => {
		const resolver = createEnvironmentCredentialResolver({
			ZOTERO_TEST_KEY: "secret",
		});
		await expect(resolver("env:ZOTERO_TEST_KEY")).resolves.toBe(
			"secret",
		);
		await expect(resolver("vault:zotero")).rejects.toBeInstanceOf(
			SourceCredentialNotFoundError,
		);
	});

	it("persists the exact snapshot scope and soft-trash state in partial cursors", () => {
		expect(
			zoteroCursorSchema.parse({
				libraryVersion: 12,
				softTrashedCollectionKeys: ["CCCC2345"],
				softTrashedItemKeys: ["AAAA2345"],
				pending: {
					offset: 500,
					snapshotSince: 12,
					targetVersion: 20,
				},
			}),
		).toMatchObject({
			libraryVersion: 12,
			pending: {
				offset: 500,
				snapshotSince: 12,
				targetVersion: 20,
			},
		});
	});

	it("rejects API keys without access to the configured library", async () => {
		const client = new ZoteroApiClient({
			apiBaseUrl: "https://api.zotero.test",
			apiKey: "secret",
			fetch: async () =>
				new Response(
					JSON.stringify({
						access: {
							groups: {
								"999": { library: false },
							},
						},
						userID: 123,
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					},
				),
			requestTimeoutMs: 1_000,
		});
		await expect(
			client.verifyKeyAccess({
				externalScopeKey: "999",
				kind: "group",
			}),
		).rejects.toBeInstanceOf(ZoteroApiError);
	});
});

describe("Zotero source mapping", () => {
	it("maps provider fields without leaking relationship or file sidecars into metadata", async () => {
		const response = zoteroItemResponseSchema.parse({
			key: "AAAA2345",
			version: 7,
			links: {
				alternate: {
					href: "https://www.zotero.org/groups/1/items/AAAA2345",
				},
			},
			data: {
				collections: ["CCCC2345"],
				contentType: "application/pdf",
				dateAdded: "2026-07-01T00:00:00Z",
				dateModified: "2026-07-02T00:00:00Z",
				filename: "paper.pdf",
				inPublications: false,
				itemType: "attachment",
				key: "AAAA2345",
				lastRead: "2026-07-02T01:00:00Z",
				linkMode: "imported_file",
				parentItem: "BBBB2345",
				path: "storage:paper.pdf",
				relations: {},
				note: "<p>Attachment note</p>",
				tags: [{ tag: "publishPDF", type: 1 }],
				title: "Paper",
				version: 7,
			},
		});
		const mapped = await mapZoteroItem(response, async () => ({
			charset: null,
			contentType: "application/pdf",
			coverHeight: null,
			coverUrl: null,
			coverWidth: null,
			filename: "paper.pdf",
			fullText: null,
			linkMode: "imported_file",
			md5: null,
			mtime: null,
			url: "https://storage.example.org/paper.pdf",
		}));
		expect(mapped).toMatchObject({
			operation: "upsert",
			sourceRecordKey: "AAAA2345",
			parentSourceRecordKey: "BBBB2345",
			collections: [{ sourceRecordKey: "CCCC2345" }],
			metadata: {
				itemType: "attachment",
				tags: ["publishPDF"],
				title: "Paper",
				note: "<p>Attachment note</p>",
			},
			file: {
				url: "https://storage.example.org/paper.pdf",
			},
		});
		if (mapped.operation === "upsert") {
			expect(mapped.metadata).not.toHaveProperty("contentType");
			expect(mapped.metadata).not.toHaveProperty("parentItem");
			expect(mapped.metadata).not.toHaveProperty("collections");
			expect(mapped.metadata).not.toHaveProperty("inPublications");
			expect(mapped.metadata).not.toHaveProperty("lastRead");
			expect(mapped.metadata).not.toHaveProperty("path");
			expect(mapped.aliases).toEqual([
				{
					key: "https://www.zotero.org/groups/1/items/AAAA2345",
					kind: "zotero-uri",
				},
			]);
		}
	});

	it("maps Zotero annotation fields as canonical metadata", async () => {
		const mapped = await mapZoteroItem(
			zoteroItemResponseSchema.parse({
				key: "ZZZZ2345",
				version: 9,
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
					itemType: "annotation",
					parentItem: "BBBB2345",
				},
			}),
		);
		expect(mapped).toMatchObject({
			operation: "upsert",
			parentSourceRecordKey: "BBBB2345",
			metadata: {
				annotationType: "highlight",
				annotationText: "Evidence",
				annotationComment: "Important",
				itemType: "annotation",
			},
		});
	});

	it("maps trashed items and nested collections", async () => {
		const trashed = await mapZoteroItem(
			zoteroItemResponseSchema.parse({
				key: "AAAA2345",
				version: 8,
				data: {
					deleted: 1,
					itemType: "document",
				},
			}),
		);
		expect(trashed).toMatchObject({
			operation: "delete",
			remoteVersion: "8",
			sourceRecordKey: "AAAA2345",
		});

		expect(
			mapZoteroCollection({
				key: "CCCC2345",
				version: 4,
				data: {
					name: "Child",
					parentCollection: "DDDD2345",
				},
				meta: { numCollections: 0, numItems: 2 },
			}),
		).toMatchObject({
			operation: "upsert",
			parentSourceRecordKey: "DDDD2345",
			sourceRecordKey: "CCCC2345",
		});
	});
});
