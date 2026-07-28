import "server-only";

export type ZoteroTranslationErrorCode =
	| "TRANSLATION_REQUEST_FAILED"
	| "TRANSLATION_RESPONSE_INVALID";

export class ZoteroTranslationError extends Error {
	readonly code: ZoteroTranslationErrorCode;
	readonly status: number | null;

	constructor(
		message: string,
		{
			code,
			status = null,
			cause,
		}: {
			code: ZoteroTranslationErrorCode;
			status?: number | null;
			cause?: unknown;
		},
	) {
		super(message, { cause });
		this.name = "ZoteroTranslationError";
		this.code = code;
		this.status = status;
	}
}

export function getZoteroExportUrl(
	translationUrl: string,
	format: "csljson",
) {
	const url = new URL(translationUrl);
	url.pathname = `${url.pathname.replace(/\/+$/u, "")}/export`;
	url.searchParams.set("format", format);
	return url;
}

function ensureCiteprocEligibleItem(item: Record<string, unknown>) {
	if ("author" in item || "title" in item || "issued" in item) {
		return item;
	}

	return {
		...item,
		title: "Untitled",
	};
}

export async function translateZoteroItemToCSL(
	zoteroItem: unknown,
	itemId: string,
	translationUrl: string | undefined,
) {
	if (!translationUrl) return null;

	const url = getZoteroExportUrl(translationUrl, "csljson");
	let response: Response;

	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify([zoteroItem]),
		});
	} catch (error) {
		throw new ZoteroTranslationError(
			`Failed to generate CSL for item ${itemId}`,
			{
				code: "TRANSLATION_REQUEST_FAILED",
				cause: error,
			},
		);
	}

	if (!response.ok) {
		throw new ZoteroTranslationError(
			`Failed to generate CSL for item ${itemId}`,
			{
				code: "TRANSLATION_REQUEST_FAILED",
				status: response.status,
			},
		);
	}

	let data: unknown;
	try {
		data = await response.json();
	} catch (error) {
		throw new ZoteroTranslationError(
			`Zotero translation returned invalid JSON for item ${itemId}`,
			{
				code: "TRANSLATION_RESPONSE_INVALID",
				status: response.status,
				cause: error,
			},
		);
	}

	if (!Array.isArray(data)) {
		throw new ZoteroTranslationError(
			`Zotero translation returned an invalid response for item ${itemId}`,
			{
				code: "TRANSLATION_RESPONSE_INVALID",
				status: response.status,
			},
		);
	}

	const firstItem = data[0];
	if (firstItem === undefined) return null;

	if (
		!firstItem ||
		typeof firstItem !== "object" ||
		Array.isArray(firstItem)
	) {
		throw new ZoteroTranslationError(
			`Zotero translation returned an invalid item for ${itemId}`,
			{
				code: "TRANSLATION_RESPONSE_INVALID",
				status: response.status,
			},
		);
	}

	return ensureCiteprocEligibleItem(
		firstItem as Record<string, unknown>,
	);
}
