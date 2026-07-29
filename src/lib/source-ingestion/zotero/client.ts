import {
	zoteroCollectionResponseSchema,
	zoteroDeletedSchema,
	zoteroItemResponseSchema,
	zoteroKeyAccessSchema,
	zoteroVersionsSchema,
	type ZoteroCollectionResponse,
	type ZoteroItemResponse,
} from "./schema";

type Fetch = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;
export const ZOTERO_OBJECT_REQUEST_SIZE = 50;

export type ZoteroLibraryScope =
	| {
			externalScopeKey: string;
			kind: "group";
	  }
	| {
			externalScopeKey: string;
			kind: "personal-library";
	  };

type ZoteroApiClientOptions = {
	apiBaseUrl: string;
	apiKey: string | null;
	fetch?: Fetch;
	requestTimeoutMs: number;
	sleep?: Sleep;
};

type ZoteroResponse<T> = {
	data: T;
	libraryVersion: number;
};

export class ZoteroApiError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "ZoteroApiError";
	}
}

function parseLibraryVersion(response: Response) {
	const value = response.headers.get("last-modified-version");
	const parsed = value === null ? Number.NaN : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new ZoteroApiError(
			"Zotero response omitted a valid Last-Modified-Version header",
			response.status,
		);
	}
	return parsed;
}

function retryDelay(response: Response, attempt: number) {
	const retryAfter = Number(response.headers.get("retry-after"));
	if (Number.isFinite(retryAfter) && retryAfter >= 0) {
		return Math.min(retryAfter * 1_000, 60_000);
	}
	return Math.min(250 * 2 ** attempt, 5_000);
}

export class ZoteroApiClient {
	private backoffUntil = 0;
	private readonly fetchImplementation: Fetch;
	private readonly sleep: Sleep;

	constructor(private readonly options: ZoteroApiClientOptions) {
		this.fetchImplementation = options.fetch ?? fetch;
		this.sleep =
			options.sleep ??
			((milliseconds) =>
				new Promise((resolve) => setTimeout(resolve, milliseconds)));
	}

	private async waitForBackoff() {
		const delay = this.backoffUntil - Date.now();
		if (delay > 0) await this.sleep(delay);
	}

	private async request(path: string, query?: URLSearchParams) {
		for (let attempt = 0; attempt < 4; attempt += 1) {
			await this.waitForBackoff();
			const url = new URL(
				path.replace(/^\/+/, ""),
				`${this.options.apiBaseUrl.replace(/\/+$/, "")}/`,
			);
			if (query) url.search = query.toString();

			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(),
				this.options.requestTimeoutMs,
			);
			let response: Response;
			try {
				response = await this.fetchImplementation(url, {
					headers: {
						Accept: "application/json",
						...(this.options.apiKey
							? { "Zotero-API-Key": this.options.apiKey }
							: {}),
						"Zotero-API-Version": "3",
					},
					signal: controller.signal,
				});
			} catch (error) {
				if (attempt === 3) {
					throw new ZoteroApiError(
						`Zotero request failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				await this.sleep(Math.min(250 * 2 ** attempt, 5_000));
				continue;
			} finally {
				clearTimeout(timeout);
			}

			const backoff = Number(response.headers.get("backoff"));
			if (Number.isFinite(backoff) && backoff > 0) {
				this.backoffUntil = Math.max(
					this.backoffUntil,
					Date.now() + Math.min(backoff * 1_000, 60_000),
				);
			}

			if (
				(response.status === 429 || response.status >= 500) &&
				attempt < 3
			) {
				await this.sleep(retryDelay(response, attempt));
				continue;
			}
			if (!response.ok) {
				throw new ZoteroApiError(
					`Zotero request failed with ${response.status} ${response.statusText}`,
					response.status,
				);
			}
			return response;
		}
		throw new ZoteroApiError("Zotero request exhausted retries");
	}

	async verifyKeyAccess(scope: ZoteroLibraryScope) {
		if (!this.options.apiKey) return;
		const response = await this.request("keys/current");
		const key = zoteroKeyAccessSchema.parse(await response.json());
		const hasLibraryAccess =
			scope.kind === "personal-library"
				? String(key.userID) === scope.externalScopeKey &&
					key.access.user?.library === true
				: key.access.groups?.all?.library === true ||
					key.access.groups?.[scope.externalScopeKey]?.library ===
						true;
		if (!hasLibraryAccess) {
			throw new ZoteroApiError(
				`Zotero API key cannot read ${scope.kind} ${scope.externalScopeKey}`,
				403,
			);
		}
	}

	async versions(
		prefix: string,
		entity: "collections" | "items",
		since: number,
	): Promise<ZoteroResponse<Record<string, number>>> {
		const query = new URLSearchParams({
			format: "versions",
			since: String(since),
		});
		if (entity === "items") query.set("includeTrashed", "1");
		const response = await this.request(`${prefix}/${entity}`, query);
		return {
			data: zoteroVersionsSchema.parse(await response.json()),
			libraryVersion: parseLibraryVersion(response),
		};
	}

	async deleted(
		prefix: string,
		since: number,
	): Promise<
		ZoteroResponse<{
			collections: string[];
			items: string[];
			searches: string[];
			tags: string[];
		}>
	> {
		const response = await this.request(
			`${prefix}/deleted`,
			new URLSearchParams({ since: String(since) }),
		);
		return {
			data: zoteroDeletedSchema.parse(await response.json()),
			libraryVersion: parseLibraryVersion(response),
		};
	}

	async collections(
		prefix: string,
		keys: string[],
	): Promise<ZoteroResponse<ZoteroCollectionResponse[]>> {
		const response = await this.request(
			`${prefix}/collections`,
			new URLSearchParams({
				collectionKey: keys.join(","),
				limit: String(ZOTERO_OBJECT_REQUEST_SIZE),
			}),
		);
		return {
			data: zoteroCollectionResponseSchema
				.array()
				.parse(await response.json()),
			libraryVersion: parseLibraryVersion(response),
		};
	}

	async items(
		prefix: string,
		keys: string[],
	): Promise<ZoteroResponse<ZoteroItemResponse[]>> {
		const response = await this.request(
			`${prefix}/items`,
			new URLSearchParams({
				includeTrashed: "1",
				itemKey: keys.join(","),
				limit: String(ZOTERO_OBJECT_REQUEST_SIZE),
			}),
		);
		return {
			data: zoteroItemResponseSchema.array().parse(await response.json()),
			libraryVersion: parseLibraryVersion(response),
		};
	}
}
