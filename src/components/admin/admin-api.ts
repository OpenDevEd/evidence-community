"use client";

import type {
	AdminCollection,
	AdminCollectionCatalogEntry,
	AdminCollectionCatalogPage,
	AdminItemDetail,
	AdminItemDraft,
	AdminItemListPage,
	AdminLibrarySnapshot,
} from "@/lib/admin/types";
import type { AdminCollectionSearchState } from "@/lib/admin/collection-catalog-contract";
import type {
	AdminErrorCode,
	AdminErrorPayload,
	AdminFieldErrors,
} from "@/lib/admin/errors";
import type {
	AdminItemBatchRequest,
	AdminItemBatchResponse,
	AdminItemBatchResult,
} from "@/lib/admin/item-batch-contract";
import { ADMIN_ITEM_BATCH_SIZE } from "@/lib/admin/item-batch-contract";
import type {
	AdminSearchIndexMutationResult,
	AdminSearchIndexOverview,
	AdminSearchIndexReceipt,
	AdminSearchIndexReceiptStatus,
	AdminSearchIndexRetryRequest,
} from "@/lib/admin/search-index-contract";
import {
	adminSearchIndexReceiptIdentity,
	adminSearchIndexMutationResultSchema,
	adminSearchIndexOverviewSchema,
	adminSearchIndexReceiptSchema,
	adminSearchIndexReceiptStatusSchema,
} from "@/lib/admin/search-index-contract";
import {
	adminSourceWritebackStatusSchema,
	type AdminSourceWritebackStatus,
} from "@/lib/admin/source-writeback-contract";

export class AdminApiError extends Error {
	readonly code: AdminErrorCode;
	readonly fields: AdminFieldErrors;
	readonly status: number;

	constructor(details: AdminErrorPayload["error"], status: number) {
		super(details.message);
		this.name = "AdminApiError";
		this.code = details.code;
		this.fields = details.fields ?? {};
		this.status = status;
	}
}

function fallbackError(status: number): AdminErrorPayload["error"] {
	if (status === 404) {
		return {
			code: "not_found",
			message: "The requested content is no longer available.",
		};
	}
	if (status === 409) {
		return {
			code: "conflict",
			message:
				"This content changed while you were editing it. Refresh and try again.",
		};
	}
	return {
		code: "internal_error",
		message: "Something went wrong. Try again.",
	};
}

const adminErrorCodes = new Set<AdminErrorCode>([
	"already_exists",
	"conflict",
	"internal_error",
	"invalid_reference",
	"not_found",
	"storage_unavailable",
	"validation_failed",
]);

function parsedError(
	value: unknown,
	status: number,
): AdminErrorPayload["error"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return fallbackError(status);
	}
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.code !== "string" ||
		!adminErrorCodes.has(candidate.code as AdminErrorCode) ||
		typeof candidate.message !== "string"
	) {
		return fallbackError(status);
	}
	if (
		candidate.fields !== undefined &&
		(!candidate.fields ||
			typeof candidate.fields !== "object" ||
			Array.isArray(candidate.fields) ||
			Object.values(candidate.fields).some(
				(message) => typeof message !== "string",
			))
	) {
		return fallbackError(status);
	}
	return {
		code: candidate.code as AdminErrorCode,
		...(candidate.fields
			? { fields: candidate.fields as AdminFieldErrors }
			: {}),
		message: candidate.message,
	};
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...init,
		cache: "no-store",
		headers: {
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...init?.headers,
		},
	});
	if (!response.ok) {
		const body = (await response
			.json()
			.catch(() => null)) as AdminErrorPayload | null;
		const details = parsedError(body?.error, response.status);
		throw new AdminApiError(details, response.status);
	}
	if (response.status === 204) return undefined as T;
	return response.json() as Promise<T>;
}

function invalidSearchIndexResponse() {
	return new AdminApiError(
		{
			code: "internal_error",
			message:
				"The server returned an invalid search indexing response. Refresh and try again.",
		},
		502,
	);
}

function invalidSourceWritebackResponse() {
	return new AdminApiError(
		{
			code: "internal_error",
			message:
				"The server returned an invalid writeback status. Refresh and try again.",
		},
		502,
	);
}

async function requestIndexingMutation<T extends object>(
	path: string,
	init?: RequestInit,
): Promise<T & AdminSearchIndexMutationResult> {
	const response = await requestJson<unknown>(path, init);
	if (!adminSearchIndexMutationResultSchema.safeParse(response).success) {
		throw invalidSearchIndexResponse();
	}
	return response as T & AdminSearchIndexMutationResult;
}

export function getAdminLibrary() {
	return requestJson<AdminLibrarySnapshot>("/api/admin/library");
}

export function getAdminItems(
	searchParams: URLSearchParams,
	signal?: AbortSignal,
) {
	return requestJson<AdminItemListPage>(
		`/api/admin/items?${searchParams.toString()}`,
		{ signal },
	);
}

function collectionCatalogUrl(
	view: "children" | "resolve" | "search",
	parameters: Record<string, boolean | null | number | string | undefined>,
) {
	const searchParams = new URLSearchParams({ view });
	for (const [key, value] of Object.entries(parameters)) {
		if (value !== null && value !== undefined && value !== "") {
			searchParams.set(key, String(value));
		}
	}
	return `/api/admin/collections?${searchParams.toString()}`;
}

export function getAdminCollectionChildren(
	input: {
		cursor?: string | null;
		pageSize?: number;
		parentCollection: string | null;
		sourceConnectionKey: string;
	},
	signal?: AbortSignal,
) {
	return requestJson<AdminCollectionCatalogPage>(
		collectionCatalogUrl("children", {
			cursor: input.cursor,
			pageSize: input.pageSize,
			parent: input.parentCollection ?? "root",
			source: input.sourceConnectionKey,
		}),
		{ signal },
	);
}

export function searchAdminCollectionCatalog(
	input: {
		cursor?: string | null;
		pageSize?: number;
		query: string;
		sourceConnectionKey?: string | null;
		state?: AdminCollectionSearchState;
	},
	signal?: AbortSignal,
) {
	return requestJson<AdminCollectionCatalogPage>(
		collectionCatalogUrl("search", {
			cursor: input.cursor,
			pageSize: input.pageSize,
			query: input.query,
			source: input.sourceConnectionKey,
			state: input.state,
		}),
		{ signal },
	);
}

export function resolveAdminCollectionCatalog(
	keys: readonly string[],
	signal?: AbortSignal,
) {
	const searchParams = new URLSearchParams({ view: "resolve" });
	for (const key of keys) searchParams.append("key", key);
	return requestJson<{ items: AdminCollectionCatalogEntry[] }>(
		`/api/admin/collections?${searchParams.toString()}`,
		{ signal },
	);
}

export async function getAdminItem(key: string) {
	return (
		await requestJson<{ item: AdminItemDetail }>(
			`/api/admin/items/${encodeURIComponent(key)}`,
		)
	).item;
}

export async function createAdminDraft(payload: Record<string, unknown>) {
	return (
		await requestJson<{ draft: AdminItemDraft }>(
			"/api/admin/items/drafts",
			{ method: "POST", body: JSON.stringify(payload) },
		)
	).draft;
}

export async function openAdminDraft(key: string) {
	return (
		await requestJson<{ draft: AdminItemDraft }>(
			`/api/admin/items/${encodeURIComponent(key)}/draft`,
			{ method: "POST" },
		)
	).draft;
}

export async function saveAdminDraft(
	key: string,
	expectedDraftRevision: number,
	expectedPayload: Record<string, unknown>,
	payload: Record<string, unknown>,
) {
	return (
		await requestJson<{ draft: AdminItemDraft }>(
			`/api/admin/items/${encodeURIComponent(key)}/draft`,
			{
				method: "PUT",
				body: JSON.stringify({
					expectedDraftRevision,
					expectedPayload,
					payload,
				}),
			},
		)
	).draft;
}

export function discardAdminDraft(key: string) {
	return requestJson<void>(
		`/api/admin/items/${encodeURIComponent(key)}/draft`,
		{ method: "DELETE" },
	);
}

export function publishAdminItem(key: string) {
	return requestIndexingMutation<{ item: Record<string, unknown> }>(
		`/api/admin/items/${encodeURIComponent(key)}/publish`,
		{ method: "POST" },
	);
}

export function unpublishAdminItem(key: string) {
	return requestIndexingMutation<{ item: Record<string, unknown> }>(
		`/api/admin/items/${encodeURIComponent(key)}/unpublish`,
		{ method: "POST" },
	);
}

async function sourceWritebackStatusRequest(
	key: string,
	method: "GET" | "POST",
	signal?: AbortSignal,
): Promise<AdminSourceWritebackStatus> {
	const response = await requestJson<unknown>(
		`/api/admin/items/${encodeURIComponent(key)}/writeback/${method === "GET" ? "status" : "retry"}`,
		{ method, signal },
	);
	const status =
		response && typeof response === "object" && "status" in response
			? response.status
			: undefined;
	const parsed = adminSourceWritebackStatusSchema.safeParse(status);
	if (!parsed.success) throw invalidSourceWritebackResponse();
	return parsed.data;
}

export function getAdminSourceWritebackStatus(
	key: string,
	signal?: AbortSignal,
) {
	return sourceWritebackStatusRequest(key, "GET", signal);
}

export function retryAdminSourceWriteback(key: string) {
	return sourceWritebackStatusRequest(key, "POST");
}

function itemBatchChunks(input: AdminItemBatchRequest) {
	return Array.from(
		{ length: Math.ceil(input.keys.length / ADMIN_ITEM_BATCH_SIZE) },
		(_, index) => ({
			...input,
			keys: input.keys.slice(
				index * ADMIN_ITEM_BATCH_SIZE,
				(index + 1) * ADMIN_ITEM_BATCH_SIZE,
			),
		}),
	);
}

function failedBatchChunk(
	error: unknown,
	keys: readonly string[],
): AdminItemBatchResult[] {
	const details =
		error instanceof AdminApiError
			? {
					code: error.code,
					fields: error.fields,
					message: error.message,
				}
			: {
					code: "internal_error" as const,
					message:
						"The selected records could not be updated. Try again.",
				};
	return keys.map((key) => ({
		...details,
		indexingReceipts: [],
		key,
		outcome: "failed",
	}));
}

async function mutateAdminItemChunks(input: AdminItemBatchRequest) {
	const results: AdminItemBatchResult[] = [];
	for (const chunk of itemBatchChunks(input)) {
		try {
			const response = await requestJson<AdminItemBatchResponse>(
				"/api/admin/items/batch",
				{
					body: JSON.stringify(chunk),
					method: "POST",
				},
			);
			if (
				response.results.some(
					(result) =>
						!Array.isArray(result.indexingReceipts) ||
						result.indexingReceipts.some(
							(receipt) =>
								!adminSearchIndexReceiptSchema.safeParse(
									receipt,
								).success,
						),
				)
			) {
				throw invalidSearchIndexResponse();
			}
			results.push(...response.results);
		} catch (error) {
			results.push(...failedBatchChunk(error, chunk.keys));
		}
	}
	return results;
}

export async function mutateAdminItems(input: AdminItemBatchRequest) {
	const firstPass = await mutateAdminItemChunks(input);
	const resultByKey = new Map(
		firstPass.map((result) => [result.key, result]),
	);
	let retryKeys = firstPass
		.filter(({ retryable }) => retryable)
		.map(({ key }) => key);
	while (retryKeys.length > 0) {
		const retried = await mutateAdminItemChunks({
			...input,
			keys: retryKeys,
		});
		for (const result of retried) resultByKey.set(result.key, result);
		const nextRetryKeys = retried
			.filter(({ retryable }) => retryable)
			.map(({ key }) => key);
		if (nextRetryKeys.length >= retryKeys.length) break;
		retryKeys = nextRetryKeys;
	}
	return {
		results: firstPass.map(
			(result) => resultByKey.get(result.key) ?? result,
		),
	};
}

export function createAdminCollection(input: {
	name: string;
	parentCollection: string | null;
	sourceConnectionKey: string;
}) {
	return requestIndexingMutation<{ collection: AdminCollection }>(
		"/api/admin/collections",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function renameAdminCollection(
	key: string,
	input: { expectedRevision: number; name: string },
) {
	return requestIndexingMutation<{ collection: AdminCollection }>(
		`/api/admin/collections/${encodeURIComponent(key)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
	);
}

export function moveAdminCollection(
	key: string,
	input:
		| { expectedRevision: number; position: "root" }
		| {
				expectedRevision: number;
				position: "after" | "before" | "inside";
				targetCollection: string;
		  },
) {
	return requestIndexingMutation<{
		collection: AdminCollection;
		collections: AdminCollection[];
	}>(`/api/admin/collections/${encodeURIComponent(key)}/move`, {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function deleteAdminCollection(key: string, expectedRevision: number) {
	return requestIndexingMutation<{ collections: AdminCollection[] }>(
		`/api/admin/collections/${encodeURIComponent(key)}`,
		{
			method: "DELETE",
			body: JSON.stringify({ expectedRevision }),
		},
	);
}

export function restoreAdminCollection(key: string, expectedRevision: number) {
	return requestIndexingMutation<{
		collection: AdminCollection;
		collections: AdminCollection[];
	}>(`/api/admin/collections/${encodeURIComponent(key)}/restore`, {
		method: "POST",
		body: JSON.stringify({ expectedRevision }),
	});
}

type StageFileResponse = {
	fileDraft: {
		uploadRevision: number;
	};
	upload: {
		path: string;
		signedUrl: string;
		token: string;
	};
};

export function stageAdminPdf(
	key: string,
	input: {
		expectedSha256: string;
		expectedSizeBytes: number;
		filename: string;
	},
) {
	return requestJson<StageFileResponse>(
		`/api/admin/items/${encodeURIComponent(key)}/file`,
		{ method: "POST", body: JSON.stringify(input) },
	);
}

export async function uploadAdminPdf(signedUrl: string, file: File) {
	const body = new FormData();
	body.append("cacheControl", "3600");
	body.append("", file);
	const response = await fetch(signedUrl, {
		method: "PUT",
		body,
		headers: { "x-upsert": "true" },
	});
	if (!response.ok) {
		throw new AdminApiError(
			{
				code: "storage_unavailable",
				message: "The PDF could not be uploaded. Try again.",
			},
			response.status,
		);
	}
}

export function completeAdminPdf(key: string, expectedUploadRevision: number) {
	return requestJson(
		`/api/admin/items/${encodeURIComponent(key)}/file/complete`,
		{
			method: "POST",
			body: JSON.stringify({ expectedUploadRevision }),
		},
	);
}

export function discardAdminPdfDraft(key: string) {
	return requestJson<void>(
		`/api/admin/items/${encodeURIComponent(key)}/file/draft`,
		{ method: "DELETE" },
	);
}

export function publishAdminPdf(key: string, expectedUploadRevision: number) {
	return requestIndexingMutation<{ item: Record<string, unknown> }>(
		`/api/admin/items/${encodeURIComponent(key)}/file/publish`,
		{
			method: "POST",
			body: JSON.stringify({ expectedUploadRevision }),
		},
	);
}

export function unpublishAdminPdf(key: string) {
	return requestIndexingMutation<{ item: Record<string, unknown> }>(
		`/api/admin/items/${encodeURIComponent(key)}/file`,
		{
			method: "DELETE",
		},
	);
}

export async function getAdminSearchIndexOverview(signal?: AbortSignal) {
	const response = await requestJson<unknown>("/api/admin/search-index", {
		signal,
	});
	const parsed = adminSearchIndexOverviewSchema.safeParse(response);
	if (!parsed.success) throw invalidSearchIndexResponse();
	return parsed.data satisfies AdminSearchIndexOverview;
}

export async function getAdminSearchIndexReceipts(
	receipts: readonly AdminSearchIndexReceipt[],
	signal?: AbortSignal,
) {
	const response = await requestJson<unknown>(
		"/api/admin/search-index/receipts",
		{
			body: JSON.stringify({ receipts }),
			method: "POST",
			signal,
		},
	);
	const receiptsResponse =
		response && typeof response === "object" && "receipts" in response
			? response.receipts
			: undefined;
	const parsed = adminSearchIndexReceiptStatusSchema
		.array()
		.safeParse(receiptsResponse);
	if (!parsed.success) throw invalidSearchIndexResponse();
	const requestedIdentities = new Set(
		receipts.map(adminSearchIndexReceiptIdentity),
	);
	const returnedIdentities = new Set(
		parsed.data.map(adminSearchIndexReceiptIdentity),
	);
	if (
		returnedIdentities.size !== parsed.data.length ||
		returnedIdentities.size !== requestedIdentities.size ||
		[...requestedIdentities].some(
			(identity) => !returnedIdentities.has(identity),
		)
	) {
		throw invalidSearchIndexResponse();
	}
	return { receipts: parsed.data satisfies AdminSearchIndexReceiptStatus[] };
}

export async function retryAdminSearchIndex(
	input: AdminSearchIndexRetryRequest,
) {
	const response = await requestJson<unknown>(
		"/api/admin/search-index/retry",
		{
			body: JSON.stringify(input),
			method: "POST",
		},
	);
	if (!response || typeof response !== "object") {
		throw invalidSearchIndexResponse();
	}
	const receipts =
		"receipts" in response
			? adminSearchIndexReceiptSchema.array().safeParse(response.receipts)
			: null;
	if (
		!receipts?.success ||
		!("requeued" in response) ||
		typeof response.requeued !== "number" ||
		!Number.isSafeInteger(response.requeued) ||
		response.requeued < 0
	) {
		throw invalidSearchIndexResponse();
	}
	return { receipts: receipts.data, requeued: response.requeued };
}

export async function sha256File(file: File) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		await file.arrayBuffer(),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
