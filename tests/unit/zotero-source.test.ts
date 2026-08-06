import { describe, expect, it } from "vitest";

import {
	SourceCredentialNotFoundError,
	createEnvironmentCredentialResolver,
} from "@/lib/source-ingestion/credentials";
import { sourceIngestionBatchSchema } from "@/lib/source-ingestion/batch-schema";
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
			attachmentDownloadTimeoutMs: 120_000,
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
		await expect(resolver("env:ZOTERO_TEST_KEY")).resolves.toBe("secret");
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

	it("backs off on transient API errors when Retry-After is absent", async () => {
		let attempts = 0;
		const delays: number[] = [];
		const client = new ZoteroApiClient({
			apiBaseUrl: "https://api.zotero.test",
			apiKey: "secret",
			fetch: async () => {
				attempts += 1;
				return attempts === 1
					? new Response("temporary", { status: 503 })
					: new Response(
							JSON.stringify({
								access: { groups: { all: { library: true } } },
								userID: 123,
							}),
						);
			},
			requestTimeoutMs: 1_000,
			sleep: async (milliseconds) => {
				delays.push(milliseconds);
			},
		});
		await client.verifyKeyAccess({
			externalScopeKey: "999",
			kind: "group",
		});
		expect(attempts).toBe(2);
		expect(delays).toEqual([250]);
	});

	it("downloads bounded attachment bytes and normalizes the ETag", async () => {
		const client = new ZoteroApiClient({
			apiBaseUrl: "https://api.zotero.test",
			apiKey: "secret",
			fetch: async (_input, init) => {
				expect(new Headers(init?.headers).get("accept")).toBe(
					"application/pdf",
				);
				return new Response(new Uint8Array([1, 2, 3]), {
					headers: {
						"content-length": "3",
						"content-type": "application/pdf",
						etag: '"abc123"',
					},
				});
			},
			requestTimeoutMs: 1_000,
		});
		await expect(
			client.downloadAttachment("groups/999", "AAAA2345", 3),
		).resolves.toMatchObject({
			bytes: new Uint8Array([1, 2, 3]),
			contentType: "application/pdf",
			etag: "abc123",
		});
	});

	it("rejects attachment responses that exceed the byte limit", async () => {
		const client = new ZoteroApiClient({
			apiBaseUrl: "https://api.zotero.test",
			apiKey: "secret",
			fetch: async () =>
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { "content-length": "4" },
				}),
			requestTimeoutMs: 1_000,
		});
		await expect(
			client.downloadAttachment("groups/999", "AAAA2345", 3),
		).rejects.toMatchObject({ status: 413 });
	});

	it("stops an attachment stream when the declared length is missing", async () => {
		const client = new ZoteroApiClient({
			apiBaseUrl: "https://api.zotero.test",
			apiKey: "secret",
			fetch: async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([1, 2]));
							controller.enqueue(new Uint8Array([3, 4]));
							controller.close();
						},
					}),
				),
			requestTimeoutMs: 1_000,
		});
		await expect(
			client.downloadAttachment("groups/999", "AAAA2345", 3),
		).rejects.toMatchObject({ status: 413 });
	});

	it("does not forward the Zotero API key to attachment storage redirects", async () => {
		const requests: Array<{ headers: Headers; url: string }> = [];
		const client = new ZoteroApiClient({
			apiBaseUrl: "https://api.zotero.test",
			apiKey: "secret",
			fetch: (async (input, init) => {
				requests.push({
					headers: new Headers(init?.headers),
					url: String(input),
				});
				return requests.length === 1
					? new Response(null, {
							headers: {
								location:
									"https://storage.zotero.test/file.pdf",
							},
							status: 302,
						})
					: new Response(new Uint8Array([1, 2, 3]));
			}) as typeof fetch,
			requestTimeoutMs: 1_000,
		});
		await client.downloadAttachment("groups/999", "AAAA2345", 3);
		expect(requests).toHaveLength(2);
		expect(requests[0]?.headers.get("zotero-api-key")).toBe("secret");
		expect(requests[1]?.url).toBe("https://storage.zotero.test/file.pdf");
		expect(requests[1]?.headers.has("zotero-api-key")).toBe(false);
	});

	it("cancels a stalled attachment stream at the inactivity bound", async () => {
		const client = new ZoteroApiClient({
			apiBaseUrl: "https://api.zotero.test",
			apiKey: "secret",
			attachmentDownloadTimeoutMs: 100,
			fetch: async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([1]));
						},
					}),
				),
			requestTimeoutMs: 10,
		});
		await expect(
			client.downloadAttachment("groups/999", "AAAA2345", 3),
		).rejects.toThrow("download timed out");
	});

	it("cancels an active attachment stream at the total deadline", async () => {
		let interval: ReturnType<typeof setInterval> | undefined;
		const client = new ZoteroApiClient({
			apiBaseUrl: "https://api.zotero.test",
			apiKey: "secret",
			attachmentDownloadTimeoutMs: 50,
			fetch: async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							interval = setInterval(
								() => controller.enqueue(new Uint8Array([1])),
								5,
							);
						},
						cancel() {
							if (interval) clearInterval(interval);
						},
					}),
				),
			requestTimeoutMs: 1_000,
		});
		await expect(
			client.downloadAttachment("groups/999", "AAAA2345", 1_000),
		).rejects.toThrow("exceeded its total deadline");
	});
});

describe("Zotero source mapping", () => {
	it("does not treat parent, child, or enclosure relationship URLs as aliases", async () => {
		const parent = await mapZoteroItem(
			zoteroItemResponseSchema.parse({
				key: "A4S7ZT9E",
				version: 1,
				links: {
					self: {
						href: "https://api.zotero.org/groups/6632364/items/A4S7ZT9E",
						type: "application/json",
					},
					alternate: {
						href: "https://www.zotero.org/groups/6632364/items/A4S7ZT9E",
						type: "text/html",
					},
					attachment: {
						href: "https://api.zotero.org/groups/6632364/items/4CK9MKRN",
						type: "application/json",
					},
				},
				data: { itemType: "report", title: "Parent" },
			}),
		);
		const attachment = await mapZoteroItem(
			zoteroItemResponseSchema.parse({
				key: "4CK9MKRN",
				version: 1,
				links: {
					self: {
						href: "https://api.zotero.org/groups/6632364/items/4CK9MKRN",
						type: "application/json",
					},
					alternate: {
						href: "https://www.zotero.org/groups/6632364/items/4CK9MKRN",
						type: "text/html",
					},
					up: {
						href: "https://api.zotero.org/groups/6632364/items/A4S7ZT9E",
						type: "application/json",
					},
					enclosure: {
						href: "https://api.zotero.org/groups/6632364/items/4CK9MKRN/file/view",
						type: "application/pdf",
					},
				},
				data: {
					contentType: "application/pdf",
					itemType: "attachment",
					parentItem: "A4S7ZT9E",
					title: "Child",
				},
			}),
		);
		const parsed = sourceIngestionBatchSchema.safeParse({
			sourceConnectionKey: "zotero-openscholar-test",
			expectedCursor: {},
			nextCursor: { libraryVersion: 1 },
			mappingProfileVersion: "test",
			fetchedAt: new Date(),
			collections: [],
			items: [parent, attachment],
		});
		expect(parsed.success).toBe(true);
		if (
			parent.operation !== "upsert" ||
			attachment.operation !== "upsert"
		) {
			throw new Error("Expected mapped upserts");
		}
		expect(parent.aliases.map(({ key }) => key)).toEqual([
			"https://api.zotero.org/groups/6632364/items/A4S7ZT9E",
			"https://www.zotero.org/groups/6632364/items/A4S7ZT9E",
		]);
		expect(attachment.aliases.map(({ key }) => key)).toEqual([
			"https://api.zotero.org/groups/6632364/items/4CK9MKRN",
			"https://www.zotero.org/groups/6632364/items/4CK9MKRN",
		]);
	});

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
			managedPublication: null,
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
					annotationPosition: '{"pageIndex":3,"rects":[[1,2,3,4]]}',
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
