"use client";

import type {
	AdminCollection,
	AdminItemDetail,
	AdminItemDraft,
	AdminItemListPage,
	AdminLibrarySnapshot,
} from "@/lib/admin/types";
import type {
	AdminErrorCode,
	AdminErrorPayload,
	AdminFieldErrors,
} from "@/lib/admin/errors";
import type {
	AdminItemBatchRequest,
	AdminItemBatchResponse,
} from "@/lib/admin/item-batch-contract";

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
	payload: Record<string, unknown>,
) {
	return (
		await requestJson<{ draft: AdminItemDraft }>(
			`/api/admin/items/${encodeURIComponent(key)}/draft`,
			{
				method: "PUT",
				body: JSON.stringify({
					expectedDraftRevision,
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
	return requestJson<{ item: Record<string, unknown> }>(
		`/api/admin/items/${encodeURIComponent(key)}/publish`,
		{ method: "POST" },
	);
}

export function unpublishAdminItem(key: string) {
	return requestJson<{ item: Record<string, unknown> }>(
		`/api/admin/items/${encodeURIComponent(key)}/unpublish`,
		{ method: "POST" },
	);
}

export function mutateAdminItems(input: AdminItemBatchRequest) {
	return requestJson<AdminItemBatchResponse>("/api/admin/items/batch", {
		body: JSON.stringify(input),
		method: "POST",
	});
}

export function createAdminCollection(input: {
	name: string;
	parentCollection: string | null;
}) {
	return requestJson<{ collection: AdminCollection }>(
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
	return requestJson<{ collection: AdminCollection }>(
		`/api/admin/collections/${encodeURIComponent(key)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
	);
}

export function moveAdminCollection(
	key: string,
	input: {
		beforeCollection: string | null;
		expectedRevision: number;
		parentCollection: string | null;
	},
) {
	return requestJson<{
		collection: AdminCollection;
		collections: AdminCollection[];
	}>(`/api/admin/collections/${encodeURIComponent(key)}/move`, {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function deleteAdminCollection(key: string, expectedRevision: number) {
	return requestJson(`/api/admin/collections/${encodeURIComponent(key)}`, {
		method: "DELETE",
		body: JSON.stringify({ expectedRevision }),
	});
}

export function restoreAdminCollection(key: string, expectedRevision: number) {
	return requestJson(
		`/api/admin/collections/${encodeURIComponent(key)}/restore`,
		{
			method: "POST",
			body: JSON.stringify({ expectedRevision }),
		},
	);
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
	return requestJson(
		`/api/admin/items/${encodeURIComponent(key)}/file/publish`,
		{
			method: "POST",
			body: JSON.stringify({ expectedUploadRevision }),
		},
	);
}

export function unpublishAdminPdf(key: string) {
	return requestJson(`/api/admin/items/${encodeURIComponent(key)}/file`, {
		method: "DELETE",
	});
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
