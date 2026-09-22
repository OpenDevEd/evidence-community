import "server-only";

export type ZoteroTranslationErrorCode =
	| "TRANSLATION_REQUEST_FAILED"
	| "TRANSLATION_RESPONSE_INVALID";

const TRANSLATION_TIMEOUT_MS = 30_000;

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
	endpoint: "import" | "search",
) {
	const url = new URL(translationUrl);
	url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${endpoint}`;
	return url;
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
			signal: AbortSignal.timeout(TRANSLATION_TIMEOUT_MS),
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
