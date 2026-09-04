import type { SourceWritebackRequest } from "@/lib/source-writeback/adapter";
import type { ZoteroItemResponse } from "@/lib/source-ingestion/zotero/schema";
import type { ZoteroCollectionResponse } from "@/lib/source-ingestion/zotero/schema";
import { sourcePayloadHash } from "@/lib/source-ingestion/fingerprint";
import {
	createZoteroWritebackAdapter,
	ZoteroWritebackKeyCollisionError,
	ZoteroWritebackTypeTransitionError,
} from "@/lib/source-writeback/zotero/adapter";
import { describe, expect, it, vi } from "vitest";

type StoredItem = ZoteroItemResponse;
type StoredCollection = ZoteroCollectionResponse;
type ItemWritebackRequest = Extract<SourceWritebackRequest, { entity: "item" }>;

function versionedResponse(
	libraryVersion: number,
	body: BodyInit | null = null,
	init: ResponseInit = {},
) {
	return new Response(body, {
		...init,
		headers: {
			"last-modified-version": String(libraryVersion),
			...init.headers,
		},
	});
}

function createFakeZotero(
	initialItems: StoredItem[] = [],
	initialCollections: StoredCollection[] = [],
) {
	const items = new Map(initialItems.map((item) => [item.key, item]));
	const collections = new Map(
		initialCollections.map((collection) => [collection.key, collection]),
	);
	let libraryVersion = Math.max(
		10,
		...initialItems.map((item) => item.version),
		...initialCollections.map((collection) => collection.version),
	);
	let patchConflict:
		((item: StoredItem, nextVersion: number) => void) | null = null;
	let deleteConflict:
		((item: StoredItem, nextVersion: number) => void) | null = null;
	let alwaysPatchConflict = false;
	let collectionPutConflict:
		((collection: StoredCollection, nextVersion: number) => void) | null =
		null;
	let collectionDeleteConflict:
		((collection: StoredCollection, nextVersion: number) => void) | null =
		null;

	const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		if (url.pathname === "/keys/current") {
			return versionedResponse(
				libraryVersion,
				JSON.stringify({
					access: {
						groups: {
							"6632364": { library: true, write: true },
						},
					},
					userID: 1,
				}),
			);
		}

		const itemMatch = url.pathname.match(
			/^\/groups\/6632364\/items\/([^/]+)$/u,
		);
		if (method === "GET" && itemMatch) {
			const item = items.get(decodeURIComponent(itemMatch[1]!));
			return item
				? versionedResponse(libraryVersion, JSON.stringify(item))
				: versionedResponse(libraryVersion, "missing", { status: 404 });
		}

		if (method === "POST" && url.pathname.endsWith("/items")) {
			const [inputItem] = JSON.parse(String(init?.body)) as Record<
				string,
				unknown
			>[];
			const key = String(inputItem!.key);
			if (inputItem!.version !== 0) {
				return versionedResponse(
					libraryVersion,
					JSON.stringify({
						failed: {
							"0": {
								code: 412,
								message:
									"Key-based item creation requires version 0",
							},
						},
					}),
				);
			}
			if (items.has(key)) {
				return versionedResponse(
					libraryVersion,
					JSON.stringify({
						failed: {
							"0": { code: 412, message: "Key exists" },
						},
					}),
				);
			}
			libraryVersion += 1;
			const { version: _version, ...data } = inputItem!;
			const stored: StoredItem = {
				data: {
					...data,
					key,
					version: libraryVersion,
				} as unknown as StoredItem["data"],
				key,
				version: libraryVersion,
			};
			items.set(key, stored);
			return versionedResponse(
				libraryVersion,
				JSON.stringify({ successful: { "0": stored } }),
			);
		}

		if ((method === "PATCH" || method === "DELETE") && itemMatch) {
			const key = decodeURIComponent(itemMatch[1]!);
			const stored = items.get(key);
			if (!stored) {
				return versionedResponse(libraryVersion, "missing", {
					status: 404,
				});
			}
			const expectedVersion = Number(
				new Headers(init?.headers).get("if-unmodified-since-version"),
			);
			const conflict =
				method === "PATCH" ? patchConflict : deleteConflict;
			if (conflict) {
				libraryVersion += 1;
				conflict(stored, libraryVersion);
				stored.version = libraryVersion;
				stored.data.version = libraryVersion;
				if (method === "PATCH") patchConflict = null;
				else deleteConflict = null;
			}
			if (alwaysPatchConflict && method === "PATCH") {
				libraryVersion += 1;
				stored.version = libraryVersion;
				stored.data.version = libraryVersion;
			}
			if (expectedVersion !== stored.version) {
				return versionedResponse(libraryVersion, "version mismatch", {
					status: 412,
				});
			}
			if (method === "DELETE") {
				items.delete(key);
				libraryVersion += 1;
				return versionedResponse(libraryVersion, null, { status: 204 });
			}

			const patch = JSON.parse(String(init?.body)) as Record<
				string,
				unknown
			>;
			for (const [field, value] of Object.entries(patch)) {
				if (field === "parentItem" && value === false) {
					delete stored.data.parentItem;
				} else if (field === "deleted" && value === false) {
					delete stored.data.deleted;
				} else {
					stored.data[field] = value;
				}
			}
			libraryVersion += 1;
			stored.version = libraryVersion;
			stored.data.version = libraryVersion;
			return versionedResponse(libraryVersion, null, { status: 204 });
		}

		const collectionMatch = url.pathname.match(
			/^\/groups\/6632364\/collections\/([^/]+)$/u,
		);
		if (method === "GET" && collectionMatch) {
			const stored = collections.get(
				decodeURIComponent(collectionMatch[1]!),
			);
			return stored
				? versionedResponse(libraryVersion, JSON.stringify(stored))
				: versionedResponse(libraryVersion, "missing", { status: 404 });
		}
		if (method === "POST" && url.pathname.endsWith("/collections")) {
			const [inputCollection] = JSON.parse(String(init?.body)) as Record<
				string,
				unknown
			>[];
			const key = String(inputCollection!.key);
			if (inputCollection!.version !== 0) {
				return versionedResponse(
					libraryVersion,
					JSON.stringify({
						failed: {
							"0": {
								code: 412,
								message:
									"Key-based collection creation requires version 0",
							},
						},
					}),
				);
			}
			if (collections.has(key)) {
				return versionedResponse(
					libraryVersion,
					JSON.stringify({
						failed: {
							"0": { code: 412, message: "Key exists" },
						},
					}),
				);
			}
			libraryVersion += 1;
			const stored: StoredCollection = {
				data: {
					...inputCollection,
					key,
					version: libraryVersion,
				} as unknown as StoredCollection["data"],
				key,
				meta: { numCollections: 0, numItems: 0 },
				version: libraryVersion,
			};
			collections.set(key, stored);
			return versionedResponse(
				libraryVersion,
				JSON.stringify({ successful: { "0": stored } }),
			);
		}
		if ((method === "PUT" || method === "DELETE") && collectionMatch) {
			const key = decodeURIComponent(collectionMatch[1]!);
			const stored = collections.get(key);
			if (!stored) {
				return versionedResponse(libraryVersion, "missing", {
					status: 404,
				});
			}
			const expectedVersion = Number(
				new Headers(init?.headers).get("if-unmodified-since-version"),
			);
			const conflict =
				method === "PUT"
					? collectionPutConflict
					: collectionDeleteConflict;
			if (conflict) {
				libraryVersion += 1;
				conflict(stored, libraryVersion);
				stored.version = libraryVersion;
				stored.data.version = libraryVersion;
				if (method === "PUT") collectionPutConflict = null;
				else collectionDeleteConflict = null;
			}
			if (expectedVersion !== stored.version) {
				return versionedResponse(libraryVersion, "version mismatch", {
					status: 412,
				});
			}
			if (method === "DELETE") {
				collections.delete(key);
				libraryVersion += 1;
				return versionedResponse(libraryVersion, null, { status: 204 });
			}
			const replacement = JSON.parse(String(init?.body)) as Record<
				string,
				unknown
			>;
			libraryVersion += 1;
			stored.data = {
				...replacement,
				key,
				version: libraryVersion,
			} as unknown as StoredCollection["data"];
			stored.version = libraryVersion;
			return versionedResponse(libraryVersion, null, { status: 204 });
		}

		return versionedResponse(libraryVersion, "unexpected request", {
			status: 500,
		});
	});

	return {
		alwaysConflictOnPatch() {
			alwaysPatchConflict = true;
		},
		conflictOnDelete(
			mutate: (item: StoredItem, nextVersion: number) => void,
		) {
			deleteConflict = mutate;
		},
		conflictOnPatch(
			mutate: (item: StoredItem, nextVersion: number) => void,
		) {
			patchConflict = mutate;
		},
		conflictOnCollectionDelete(
			mutate: (collection: StoredCollection, nextVersion: number) => void,
		) {
			collectionDeleteConflict = mutate;
		},
		conflictOnCollectionPut(
			mutate: (collection: StoredCollection, nextVersion: number) => void,
		) {
			collectionPutConflict = mutate;
		},
		collections,
		fetch: fetchImplementation,
		items,
	};
}

function remoteReport(
	data: Record<string, unknown> = {},
	version = 4,
): StoredItem {
	return {
		data: {
			collections: [],
			itemType: "report",
			key: "ABCD2345",
			relations: {},
			tags: [],
			title: "Remote title",
			version,
			...data,
		},
		key: "ABCD2345",
		version,
	};
}

function remoteCollection(
	data: Record<string, unknown> = {},
	version = 4,
): StoredCollection {
	return {
		data: {
			key: "COLL2345",
			name: "Remote collection",
			parentCollection: false,
			relations: {},
			version,
			...data,
		},
		key: "COLL2345",
		meta: { numCollections: 0, numItems: 0 },
		version,
	};
}

function request(
	overrides: Partial<ItemWritebackRequest> = {},
): ItemWritebackRequest {
	return {
		dirtyFields: ["title"],
		entity: "item",
		idempotencyKey: "source-writeback:zotero-test:ABCD2345:1:upsert",
		itemKey: "ABCD2345",
		operation: "upsert",
		payload: { itemType: "Report", title: "Local title" },
		remoteDeleted: false,
		remoteVersion: "4",
		sourceConnection: {
			config: {
				apiBaseUrl: "https://api.zotero.test",
				maxConsistencyRetries: 3,
				requestTimeoutMs: 1_000,
			},
			createdAt: new Date(0),
			displayName: null,
			externalScopeKey: "6632364",
			key: "zotero-test",
			provider: "zotero",
			scopeKind: "group",
			status: "active",
			syncCursor: {},
			updatedAt: new Date(0),
		},
		sourceRecordKey: "ABCD2345",
		...overrides,
	};
}

function collectionRequest(
	overrides: Partial<
		Extract<SourceWritebackRequest, { entity: "collection" }>
	> = {},
): Extract<SourceWritebackRequest, { entity: "collection" }> {
	return {
		collectionKey: "COLL2345",
		dirtyFields: ["name"],
		entity: "collection",
		idempotencyKey:
			"source-writeback:zotero-test:collection:COLL2345:1:upsert",
		operation: "upsert",
		payload: {
			name: "Local collection",
			parentCollection: false,
			relations: {},
		},
		remoteDeleted: false,
		remoteVersion: "4",
		sourceConnection: request().sourceConnection,
		sourceRecordKey: "COLL2345",
		...overrides,
	};
}

function context() {
	return {
		credentialResolver: vi.fn(async () => "secret"),
		signal: new AbortController().signal,
	};
}

function methods(fetchImplementation: ReturnType<typeof vi.fn>) {
	return fetchImplementation.mock.calls.map(
		([_input, init]) => init?.method ?? "GET",
	);
}

describe("Zotero writeback adapter", () => {
	it("creates a missing item with its predetermined key and snapshots the response", async () => {
		const zotero = createFakeZotero();
		const result = await createZoteroWritebackAdapter({
			fetch: zotero.fetch,
			sleep: async () => undefined,
		}).write(request({ remoteVersion: null }), context());

		expect(zotero.items.get("ABCD2345")?.data.title).toBe("Local title");
		expect(result).toMatchObject({
			remoteVersion: "11",
			snapshot: {
				fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
				mappingProfileVersion: "zotero-web-api-v3-5",
			},
			sourceRecordKey: "ABCD2345",
		});
		expect(methods(zotero.fetch)).toEqual(["GET", "GET", "POST", "GET"]);
	});

	it("accepts an exact create replay but rejects a different remote item", async () => {
		const replay = createFakeZotero([
			remoteReport({ title: "Local title" }),
		]);
		await expect(
			createZoteroWritebackAdapter({ fetch: replay.fetch }).write(
				request({ remoteVersion: null }),
				context(),
			),
		).resolves.toMatchObject({ remoteVersion: "4" });
		expect(methods(replay.fetch)).toEqual(["GET", "GET"]);

		const collision = createFakeZotero([remoteReport()]);
		await expect(
			createZoteroWritebackAdapter({ fetch: collision.fetch }).write(
				request({ remoteVersion: null }),
				context(),
			),
		).rejects.toBeInstanceOf(ZoteroWritebackKeyCollisionError);
	});

	it("rebases a dirty-field patch after 412 without overwriting unrelated remote edits", async () => {
		const zotero = createFakeZotero([
			remoteReport({ abstractNote: "Before" }),
		]);
		zotero.conflictOnPatch((item) => {
			item.data.abstractNote = "Changed remotely";
		});

		const result = await createZoteroWritebackAdapter({
			fetch: zotero.fetch,
			sleep: async () => undefined,
		}).write(request(), context());

		expect(zotero.items.get("ABCD2345")?.data).toMatchObject({
			abstractNote: "Changed remotely",
			title: "Local title",
		});
		expect(result.remoteVersion).toBe("12");
		expect(result.snapshot).toBeUndefined();
		expect(
			methods(zotero.fetch).filter((method) => method === "PATCH"),
		).toHaveLength(2);
	});

	it("reports a clean key collision when a replay field is absent remotely", async () => {
		const zotero = createFakeZotero([remoteReport({ title: undefined })]);
		await expect(
			createZoteroWritebackAdapter({ fetch: zotero.fetch }).write(
				request({ remoteVersion: null }),
				context(),
			),
		).rejects.toBeInstanceOf(ZoteroWritebackKeyCollisionError);
	});

	it("permits ordinary type changes and rejects transitions into child records", async () => {
		const ordinary = createFakeZotero([
			remoteReport({ reportType: "Study" }),
		]);
		await expect(
			createZoteroWritebackAdapter({ fetch: ordinary.fetch }).write(
				request({
					dirtyFields: ["itemType", "type"],
					payload: { itemType: "Book" },
				}),
				context(),
			),
		).resolves.toMatchObject({ sourceRecordKey: "ABCD2345" });

		const child = createFakeZotero([remoteReport()]);
		await expect(
			createZoteroWritebackAdapter({ fetch: child.fetch }).write(
				request({
					dirtyFields: ["itemType", "parentItem", "title", "url"],
					payload: {
						itemType: "Attachment",
						parentItem: "PARENT23",
						title: "PDF",
						url: "https://files.example.test/file.pdf",
					},
				}),
				context(),
			),
		).rejects.toBeInstanceOf(ZoteroWritebackTypeTransitionError);
		expect(methods(child.fetch)).not.toContain("PATCH");
	});

	it("recreates a locally restored item after remote deletion", async () => {
		const zotero = createFakeZotero();
		await expect(
			createZoteroWritebackAdapter({ fetch: zotero.fetch }).write(
				request({ remoteDeleted: true }),
				context(),
			),
		).resolves.toMatchObject({ remoteVersion: "11" });
		expect(zotero.items.get("ABCD2345")?.data.title).toBe("Local title");
		expect(methods(zotero.fetch)).toContain("POST");
	});

	it("restores a soft-deleted item with the same key", async () => {
		const zotero = createFakeZotero([
			remoteReport({ deleted: true, title: "Old title" }),
		]);
		await createZoteroWritebackAdapter({ fetch: zotero.fetch }).write(
			request({ remoteDeleted: true }),
			context(),
		);
		expect(zotero.items.get("ABCD2345")?.data.deleted).toBeUndefined();
		expect(zotero.items.get("ABCD2345")?.data.title).toBe("Local title");
	});

	it("retries a stale delete and treats an already missing item as success", async () => {
		const zotero = createFakeZotero([remoteReport()]);
		zotero.conflictOnDelete((item) => {
			item.data.abstractNote = "Concurrent edit";
		});
		await expect(
			createZoteroWritebackAdapter({
				fetch: zotero.fetch,
				sleep: async () => undefined,
			}).write(request({ operation: "delete", payload: {} }), context()),
		).resolves.toMatchObject({ remoteVersion: null });
		expect(zotero.items.has("ABCD2345")).toBe(false);
		expect(
			methods(zotero.fetch).filter((method) => method === "DELETE"),
		).toHaveLength(2);

		await expect(
			createZoteroWritebackAdapter({ fetch: zotero.fetch }).write(
				request({
					operation: "delete",
					payload: {},
					remoteDeleted: true,
					remoteVersion: null,
				}),
				context(),
			),
		).resolves.toMatchObject({ remoteVersion: null });
	});

	it("creates a collection with its canonical key and snapshots the response", async () => {
		const zotero = createFakeZotero();
		const result = await createZoteroWritebackAdapter({
			fetch: zotero.fetch,
		}).write(collectionRequest({ remoteVersion: null }), context());

		expect(zotero.collections.get("COLL2345")?.data).toMatchObject({
			name: "Local collection",
			parentCollection: false,
		});
		expect(result).toMatchObject({
			remoteVersion: "11",
			snapshot: {
				fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
				mappingProfileVersion: "zotero-web-api-v3-5",
			},
			sourceRecordKey: "COLL2345",
		});
		const postCall = zotero.fetch.mock.calls.find(
			([_input, init]) => init?.method === "POST",
		);
		expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject([
			{ key: "COLL2345", version: 0 },
		]);
		expect(methods(zotero.fetch)).toEqual(["GET", "GET", "POST", "GET"]);
	});

	it("accepts an exact collection create replay but rejects a different remote collection", async () => {
		const replay = createFakeZotero(
			[],
			[remoteCollection({ name: "Local collection" })],
		);
		await expect(
			createZoteroWritebackAdapter({ fetch: replay.fetch }).write(
				collectionRequest({ remoteVersion: null }),
				context(),
			),
		).resolves.toMatchObject({ remoteVersion: "4" });
		expect(methods(replay.fetch)).toEqual(["GET", "GET"]);

		const collision = createFakeZotero([], [remoteCollection()]);
		await expect(
			createZoteroWritebackAdapter({ fetch: collision.fetch }).write(
				collectionRequest({ remoteVersion: null }),
				context(),
			),
		).rejects.toBeInstanceOf(ZoteroWritebackKeyCollisionError);
	});

	it("rebases a collection rename and reparent after an optimistic conflict", async () => {
		const zotero = createFakeZotero([], [remoteCollection()]);
		zotero.conflictOnCollectionPut((collection) => {
			collection.data.name = "Concurrent remote name";
			collection.data.relations = {
				"dc:relation": "https://remote.example.test/change",
			};
		});

		const result = await createZoteroWritebackAdapter({
			fetch: zotero.fetch,
			sleep: async () => undefined,
		}).write(
			collectionRequest({
				dirtyFields: ["name", "parentCollection"],
				payload: {
					name: "Renamed locally",
					parentCollection: "PARN2345",
					relations: {},
				},
			}),
			context(),
		);

		expect(zotero.collections.get("COLL2345")?.data).toMatchObject({
			name: "Renamed locally",
			parentCollection: "PARN2345",
			relations: {
				"dc:relation": "https://remote.example.test/change",
			},
		});
		expect(result.remoteVersion).toBe("12");
		expect(result.snapshot).toBeUndefined();
		expect(
			methods(zotero.fetch).filter((method) => method === "PUT"),
		).toHaveLength(2);
	});

	it("deletes collections idempotently and emits the ingestion-compatible tombstone", async () => {
		const zotero = createFakeZotero([], [remoteCollection()]);
		zotero.conflictOnCollectionDelete((collection) => {
			collection.data.name = "Concurrent remote name";
		});
		const adapter = createZoteroWritebackAdapter({
			fetch: zotero.fetch,
			sleep: async () => undefined,
		});

		const deleted = await adapter.write(
			collectionRequest({ operation: "delete", payload: {} }),
			context(),
		);
		expect(zotero.collections.has("COLL2345")).toBe(false);
		expect(deleted).toMatchObject({
			remoteVersion: null,
			snapshot: {
				fingerprint: sourcePayloadHash({ deleted: true }),
				payload: { deleted: true },
			},
		});
		expect(
			methods(zotero.fetch).filter((method) => method === "DELETE"),
		).toHaveLength(2);

		await expect(
			adapter.write(
				collectionRequest({
					operation: "delete",
					payload: {},
					remoteDeleted: true,
					remoteVersion: null,
				}),
				context(),
			),
		).resolves.toMatchObject({ remoteVersion: null });
	});

	it("recreates a restored collection with the same key", async () => {
		const zotero = createFakeZotero();
		await expect(
			createZoteroWritebackAdapter({ fetch: zotero.fetch }).write(
				collectionRequest({
					remoteDeleted: true,
					remoteVersion: null,
				}),
				context(),
			),
		).resolves.toMatchObject({ remoteVersion: "11" });
		expect(zotero.collections.get("COLL2345")?.data.name).toBe(
			"Local collection",
		);
	});

	it("bounds repeated optimistic retries", async () => {
		const zotero = createFakeZotero([remoteReport()]);
		zotero.alwaysConflictOnPatch();
		await expect(
			createZoteroWritebackAdapter({
				fetch: zotero.fetch,
				sleep: async () => undefined,
			}).write(request(), context()),
		).rejects.toMatchObject({ status: 412 });
		expect(
			methods(zotero.fetch).filter((method) => method === "PATCH"),
		).toHaveLength(3);
	});
});
