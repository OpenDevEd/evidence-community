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

function getZoteroTranslationUrl(
	translationUrl: string,
	endpoint: "export" | "import" | "search",
) {
	const url = new URL(translationUrl);
	url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${endpoint}`;
	return url;
}

export function getZoteroExportUrl(
	translationUrl: string,
	format: "csljson",
) {
	const url = getZoteroTranslationUrl(translationUrl, "export");
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

/** Posts to the translation server and returns its JSON array. */
async function postZoteroTranslation(
	url: URL,
	body: string,
	contentType: string,
	subject: string,
): Promise<unknown[]> {
	let response: Response;

	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": contentType,
			},
			body,
		});
	} catch (error) {
		throw new ZoteroTranslationError(`Failed to translate ${subject}`, {
			code: "TRANSLATION_REQUEST_FAILED",
			cause: error,
		});
	}

	if (!response.ok) {
		throw new ZoteroTranslationError(`Failed to translate ${subject}`, {
			code: "TRANSLATION_REQUEST_FAILED",
			status: response.status,
		});
	}

	let data: unknown;
	try {
		data = await response.json();
	} catch (error) {
		throw new ZoteroTranslationError(
			`Zotero translation returned invalid JSON for ${subject}`,
			{
				code: "TRANSLATION_RESPONSE_INVALID",
				status: response.status,
				cause: error,
			},
		);
	}

	if (!Array.isArray(data)) {
		throw new ZoteroTranslationError(
			`Zotero translation returned an invalid response for ${subject}`,
			{
				code: "TRANSLATION_RESPONSE_INVALID",
				status: response.status,
			},
		);
	}

	return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function translateZoteroItemToCSL(
	zoteroItem: unknown,
	itemId: string,
	translationUrl: string | undefined,
) {
	if (!translationUrl) return null;

	const data = await postZoteroTranslation(
		getZoteroExportUrl(translationUrl, "csljson"),
		JSON.stringify([zoteroItem]),
		"application/json",
		`item ${itemId}`,
	);

	const firstItem = data[0];
	if (firstItem === undefined) return null;

	if (!isRecord(firstItem)) {
		throw new ZoteroTranslationError(
			`Zotero translation returned an invalid item for ${itemId}`,
			{
				code: "TRANSLATION_RESPONSE_INVALID",
			},
		);
	}

	return ensureCiteprocEligibleItem(firstItem);
}

/** Looks up one identifier (DOI, PMID, ISBN) and returns the Zotero items found. */
export async function searchZoteroIdentifier(
	identifier: string,
	translationUrl: string,
) {
	const data = await postZoteroTranslation(
		getZoteroTranslationUrl(translationUrl, "search"),
		identifier,
		"text/plain",
		`identifier ${identifier}`,
	);
	return data.filter(isRecord);
}

/** Parses a bibliography file (RIS, BibTeX, ...) into Zotero items. */
export async function importZoteroBibliography(
	content: string,
	translationUrl: string,
	subject = "bibliography",
) {
	const data = await postZoteroTranslation(
		getZoteroTranslationUrl(translationUrl, "import"),
		content,
		"text/plain",
		subject,
	);
	return data.filter(isRecord);
}
