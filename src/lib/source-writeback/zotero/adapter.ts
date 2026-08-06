import type { SourceWritebackAdapter } from "@/lib/source-writeback/adapter";
import {
	ZoteroApiError,
	type ZoteroApiClient,
} from "@/lib/source-ingestion/zotero/client";
import { createZoteroConnectionClient } from "@/lib/source-ingestion/zotero/connection";
import {
	sourceItemFingerprint,
	sourcePayloadHash,
} from "@/lib/source-ingestion/fingerprint";
import { mapZoteroItem } from "@/lib/source-ingestion/zotero/mapper";
import { ZOTERO_MAPPING_PROFILE_VERSION } from "@/lib/source-ingestion/zotero/profile";
import type { ZoteroItemResponse } from "@/lib/source-ingestion/zotero/schema";

import { createZoteroItemPatch, createZoteroItemPayload } from "./mapper";

type Fetch = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

export type ZoteroWritebackAdapterOptions = {
	fetch?: Fetch;
	sleep?: Sleep;
};

export class ZoteroWritebackKeyCollisionError extends Error {
	constructor(sourceRecordKey: string) {
		super(
			`Zotero item key ${sourceRecordKey} already exists with different data`,
		);
		this.name = "ZoteroWritebackKeyCollisionError";
	}
}

export class ZoteroWritebackTypeTransitionError extends Error {
	constructor(sourceItemType: string, targetItemType: string) {
		super(
			`Zotero cannot change ${sourceItemType} into ${targetItemType}; create a new child record instead`,
		);
		this.name = "ZoteroWritebackTypeTransitionError";
	}
}

function zoteroVersion(value: string | null) {
	if (value === null) return null;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new ZoteroApiError(
			`Invalid stored Zotero item version: ${value}`,
		);
	}
	return parsed;
}

function isMissing(error: unknown) {
	return error instanceof ZoteroApiError && error.status === 404;
}

function isOptimisticConflict(error: unknown) {
	return error instanceof ZoteroApiError && error.status === 412;
}

function isCreateCollision(error: unknown) {
	return (
		error instanceof ZoteroApiError &&
		(error.status === 409 || error.status === 412)
	);
}

async function remoteItem(
	client: ZoteroApiClient,
	prefix: string,
	itemKey: string,
	signal: AbortSignal,
) {
	try {
		return await client.item(prefix, itemKey, signal);
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
}

function jsonEqual(left: unknown, right: unknown) {
	if (left === undefined || right === undefined) return left === right;
	return (
		sourcePayloadHash(left as never) === sourcePayloadHash(right as never)
	);
}

function matchesCreatePayload(
	remote: ZoteroItemResponse,
	desired: Readonly<Record<string, unknown>>,
) {
	if (remote.key !== desired.key) return false;
	return Object.entries(desired).every(([field, value]) => {
		if (field === "version") return true;
		return jsonEqual(remote.data[field], value);
	});
}

const CHILD_ITEM_TYPES = new Set(["annotation", "attachment", "note"]);

function assertSafeTypeTransition(
	remote: ZoteroItemResponse,
	targetItemType: string,
) {
	const sourceItemType = remote.data.itemType;
	if (sourceItemType === targetItemType) return;
	if (
		CHILD_ITEM_TYPES.has(sourceItemType) ||
		CHILD_ITEM_TYPES.has(targetItemType)
	) {
		throw new ZoteroWritebackTypeTransitionError(
			sourceItemType,
			targetItemType,
		);
	}
}

async function upsertResult(
	remote: ZoteroItemResponse,
	options: { includeSnapshot?: boolean } = {},
) {
	const mapped = await mapZoteroItem(remote);
	if (mapped.operation !== "upsert") {
		throw new ZoteroApiError(
			`Zotero returned deleted item ${remote.key} after an upsert`,
		);
	}
	const result = {
		remoteVersion: String(remote.version),
		sourceRecordKey: remote.key,
	};
	if (options.includeSnapshot === false) return result;
	return {
		...result,
		snapshot: {
			fingerprint: sourceItemFingerprint(mapped),
			mappingProfileVersion: ZOTERO_MAPPING_PROFILE_VERSION,
			payload: remote as unknown as Record<string, unknown>,
		},
	};
}

function deleteResult(sourceRecordKey: string) {
	const payload = { deleted: true, key: sourceRecordKey };
	return {
		remoteVersion: null,
		snapshot: {
			fingerprint: sourcePayloadHash(payload),
			mappingProfileVersion: ZOTERO_MAPPING_PROFILE_VERSION,
			payload,
		},
		sourceRecordKey,
	};
}

function retryDelay(attempt: number) {
	return Math.min(100 * 2 ** attempt, 2_000);
}

export function createZoteroWritebackAdapter(
	options: ZoteroWritebackAdapterOptions = {},
): SourceWritebackAdapter {
	const sleep =
		options.sleep ??
		((milliseconds: number) =>
			new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

	return {
		provider: "zotero",
		async write(request, context) {
			const { client, config, prefix, scope } =
				await createZoteroConnectionClient(request.sourceConnection, {
					credentialResolver: context.credentialResolver,
					fetch: options.fetch,
					sleep,
				});
			await client.verifyKeyAccess(scope, "write", context.signal);

			const readAfterWrite = async () => {
				for (
					let attempt = 0;
					attempt < config.maxConsistencyRetries;
					attempt += 1
				) {
					const current = await remoteItem(
						client,
						prefix,
						request.sourceRecordKey,
						context.signal,
					);
					if (current) return current.data;
					if (attempt < config.maxConsistencyRetries - 1) {
						await sleep(retryDelay(attempt));
					}
				}
				throw new ZoteroApiError(
					`Zotero item ${request.sourceRecordKey} was not readable after write`,
					404,
				);
			};

			const createOrConfirm = async () => {
				const desired = createZoteroItemPayload(
					request.payload,
					request.sourceRecordKey,
				);
				try {
					const created = await client.createItem(prefix, desired, {
						signal: context.signal,
					});
					const remote = await readAfterWrite();
					return upsertResult(remote, {
						includeSnapshot:
							remote.version === created.libraryVersion,
					});
				} catch (error) {
					if (!isCreateCollision(error)) throw error;
					const existing = await remoteItem(
						client,
						prefix,
						request.sourceRecordKey,
						context.signal,
					);
					if (
						existing &&
						matchesCreatePayload(existing.data, desired)
					) {
						return upsertResult(existing.data);
					}
					throw new ZoteroWritebackKeyCollisionError(
						request.sourceRecordKey,
					);
				}
			};

			if (request.operation === "delete") {
				let version = zoteroVersion(request.remoteVersion);
				if (version === null || request.remoteDeleted) {
					const existing = await remoteItem(
						client,
						prefix,
						request.sourceRecordKey,
						context.signal,
					);
					if (!existing) return deleteResult(request.sourceRecordKey);
					version = existing.data.version;
				}

				for (
					let attempt = 0;
					attempt < config.maxConsistencyRetries;
					attempt += 1
				) {
					try {
						await client.deleteItem(
							prefix,
							request.sourceRecordKey,
							version,
							context.signal,
						);
						return deleteResult(request.sourceRecordKey);
					} catch (error) {
						if (isMissing(error)) {
							return deleteResult(request.sourceRecordKey);
						}
						if (
							!isOptimisticConflict(error) ||
							attempt === config.maxConsistencyRetries - 1
						) {
							throw error;
						}
						const latest = await remoteItem(
							client,
							prefix,
							request.sourceRecordKey,
							context.signal,
						);
						if (!latest)
							return deleteResult(request.sourceRecordKey);
						version = latest.data.version;
						await sleep(retryDelay(attempt));
					}
				}
				throw new ZoteroApiError("Zotero delete exhausted retries");
			}

			const desiredCreate = createZoteroItemPayload(
				request.payload,
				request.sourceRecordKey,
			);
			let version = zoteroVersion(request.remoteVersion);
			let current: ZoteroItemResponse | null = null;
			if (
				version === null ||
				request.remoteDeleted ||
				request.dirtyFields.includes("itemType")
			) {
				current =
					(
						await remoteItem(
							client,
							prefix,
							request.sourceRecordKey,
							context.signal,
						)
					)?.data ?? null;
				if (!current) return createOrConfirm();
				if (
					version === null &&
					!request.remoteDeleted &&
					!current.data.deleted
				) {
					if (matchesCreatePayload(current, desiredCreate)) {
						return upsertResult(current);
					}
					throw new ZoteroWritebackKeyCollisionError(
						request.sourceRecordKey,
					);
				}
				version = current.version;
			}

			const patch = createZoteroItemPatch(
				request.payload,
				request.dirtyFields,
			);
			if (current && request.dirtyFields.includes("itemType")) {
				assertSafeTypeTransition(
					current,
					desiredCreate.itemType as string,
				);
			}
			if (current?.data.deleted) patch.deleted = false;
			let rebasedAfterConflict = false;

			for (
				let attempt = 0;
				attempt < config.maxConsistencyRetries;
				attempt += 1
			) {
				try {
					const hasPatch = Object.keys(patch).length > 0;
					let writtenLibraryVersion: number | null = null;
					if (hasPatch) {
						const written = await client.patchItem(
							prefix,
							request.sourceRecordKey,
							patch,
							version!,
							context.signal,
						);
						writtenLibraryVersion = written.libraryVersion;
					}
					const remote = await readAfterWrite();
					return upsertResult(remote, {
						includeSnapshot:
							hasPatch &&
							!rebasedAfterConflict &&
							remote.version === writtenLibraryVersion,
					});
				} catch (error) {
					if (isMissing(error)) return createOrConfirm();
					if (
						!isOptimisticConflict(error) ||
						attempt === config.maxConsistencyRetries - 1
					) {
						throw error;
					}
					const latest = await remoteItem(
						client,
						prefix,
						request.sourceRecordKey,
						context.signal,
					);
					if (!latest) return createOrConfirm();
					rebasedAfterConflict = true;
					if (request.dirtyFields.includes("itemType")) {
						assertSafeTypeTransition(
							latest.data,
							desiredCreate.itemType as string,
						);
					}
					version = latest.data.version;
					if (latest.data.data.deleted) patch.deleted = false;
					await sleep(retryDelay(attempt));
				}
			}
			throw new ZoteroApiError("Zotero update exhausted retries");
		},
	};
}
