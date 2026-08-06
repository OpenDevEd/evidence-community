import {
	zoteroCollectionResponseSchema,
	zoteroDeletedSchema,
	zoteroItemResponseSchema,
	zoteroKeyAccessSchema,
	zoteroVersionsSchema,
	zoteroWriteResponseSchema,
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
	attachmentDownloadTimeoutMs?: number;
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
		public readonly responseBody?: string,
	) {
		super(message);
		this.name = "ZoteroApiError";
	}
}

export class ZoteroObjectWriteError extends ZoteroApiError {
	constructor(
		message: string,
		status: number,
		public readonly objectIndex: string,
	) {
		super(message, status);
		this.name = "ZoteroObjectWriteError";
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
	const retryAfterHeader = response.headers.get("retry-after");
	const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
	if (Number.isFinite(retryAfter) && retryAfter > 0) {
		return Math.min(retryAfter * 1_000, 60_000);
	}
	return Math.min(250 * 2 ** attempt, 5_000);
}

async function readBoundedResponse(
	response: Response,
	maxBytes: number,
	inactivityTimeoutMs: number,
	totalTimeoutMs: number,
) {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await response.body?.cancel();
		throw new ZoteroApiError(
			`Zotero attachment is ${contentLength} bytes, exceeding the ${maxBytes}-byte limit`,
			413,
		);
	}
	if (!response.body) {
		throw new ZoteroApiError("Zotero attachment response had no body");
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = Date.now() + totalTimeoutMs;
	try {
		while (true) {
			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) {
				throw new ZoteroApiError(
					"Zotero attachment download exceeded its total deadline",
				);
			}
			const read = reader.read();
			const result = await Promise.race([
				read,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(
						() =>
							reject(
								new ZoteroApiError(
									remainingMs <= inactivityTimeoutMs
										? "Zotero attachment download exceeded its total deadline"
										: "Zotero attachment download timed out",
								),
							),
						Math.min(inactivityTimeoutMs, remainingMs),
					);
				}),
			]);
			if (timeout) clearTimeout(timeout);
			if (result.done) break;
			total += result.value.byteLength;
			if (total > maxBytes) {
				throw new ZoteroApiError(
					`Zotero attachment exceeds the ${maxBytes}-byte limit`,
					413,
				);
			}
			chunks.push(result.value);
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		if (timeout) clearTimeout(timeout);
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
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

	private async request(
		path: string,
		query?: URLSearchParams,
		options: {
			accept?: string;
			apiHeaders?: boolean;
			body?: string;
			headers?: HeadersInit;
			method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
			redirect?: RequestRedirect;
			signal?: AbortSignal;
		} = {},
	) {
		for (let attempt = 0; attempt < 4; attempt += 1) {
			await this.waitForBackoff();
			const url = new URL(
				path.replace(/^\/+/, ""),
				`${this.options.apiBaseUrl.replace(/\/+$/, "")}/`,
			);
			if (query) url.search = query.toString();

			const controller = new AbortController();
			const signal = options.signal
				? AbortSignal.any([options.signal, controller.signal])
				: controller.signal;
			const timeout = setTimeout(
				() => controller.abort(),
				this.options.requestTimeoutMs,
			);
			let response: Response;
			try {
				response = await this.fetchImplementation(url, {
					body: options.body,
					headers: new Headers({
						Accept: options.accept ?? "application/json",
						...(this.options.apiKey && options.apiHeaders !== false
							? { "Zotero-API-Key": this.options.apiKey }
							: {}),
						"Zotero-API-Version": "3",
						...Object.fromEntries(
							new Headers(options.headers).entries(),
						),
					}),
					method: options.method ?? "GET",
					redirect: options.redirect,
					signal,
				});
			} catch (error) {
				if (options.signal?.aborted) {
					throw options.signal.reason ?? error;
				}
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
				await response.body?.cancel();
				await this.sleep(retryDelay(response, attempt));
				continue;
			}
			if (
				options.redirect === "manual" &&
				response.status >= 300 &&
				response.status < 400
			) {
				return response;
			}
			if (!response.ok) {
				const responseBody = (await response.text()).slice(0, 8_192);
				throw new ZoteroApiError(
					`Zotero request failed with ${response.status} ${response.statusText}${responseBody ? `: ${responseBody}` : ""}`,
					response.status,
					responseBody,
				);
			}
			return response;
		}
		throw new ZoteroApiError("Zotero request exhausted retries");
	}

	async verifyKeyAccess(
		scope: ZoteroLibraryScope,
		requiredAccess: "read" | "write" = "read",
		signal?: AbortSignal,
	) {
		if (!this.options.apiKey) {
			if (requiredAccess === "write") {
				throw new ZoteroApiError(
					`Zotero API key is required to write ${scope.kind} ${scope.externalScopeKey}`,
					403,
				);
			}
			return;
		}
		const response = await this.request("keys/current", undefined, {
			signal,
		});
		const key = zoteroKeyAccessSchema.parse(await response.json());
		const access =
			scope.kind === "personal-library"
				? String(key.userID) === scope.externalScopeKey
					? key.access.user
					: undefined
				: (key.access.groups?.[scope.externalScopeKey] ??
					key.access.groups?.all);
		const hasLibraryAccess =
			access?.library === true &&
			(requiredAccess === "read" || access.write === true);
		if (!hasLibraryAccess) {
			throw new ZoteroApiError(
				`Zotero API key cannot ${requiredAccess} ${scope.kind} ${scope.externalScopeKey}`,
				403,
			);
		}
	}

	async item(
		prefix: string,
		itemKey: string,
		signal?: AbortSignal,
	): Promise<ZoteroResponse<ZoteroItemResponse>> {
		const response = await this.request(
			`${prefix}/items/${encodeURIComponent(itemKey)}`,
			new URLSearchParams({ includeTrashed: "1" }),
			{ signal },
		);
		return {
			data: zoteroItemResponseSchema.parse(await response.json()),
			libraryVersion: parseLibraryVersion(response),
		};
	}

	async createItem(
		prefix: string,
		data: Record<string, unknown>,
		options: {
			signal?: AbortSignal;
			writeToken?: string;
		} = {},
	) {
		if (
			options.writeToken !== undefined &&
			!/^[a-zA-Z0-9]{32}$/.test(options.writeToken)
		) {
			throw new ZoteroApiError(
				"Zotero write token must contain exactly 32 alphanumeric characters",
			);
		}
		const response = await this.request(`${prefix}/items`, undefined, {
			body: JSON.stringify([data]),
			headers: {
				"Content-Type": "application/json",
				...(options.writeToken
					? { "Zotero-Write-Token": options.writeToken }
					: {}),
			},
			method: "POST",
			signal: options.signal,
		});
		const result = zoteroWriteResponseSchema.parse(await response.json());
		const failure = result.failed["0"];
		if (failure) {
			throw new ZoteroObjectWriteError(
				`Zotero rejected item creation: ${failure.message}`,
				failure.code,
				"0",
			);
		}
		if (
			!("0" in result.successful) &&
			!("0" in result.success) &&
			!("0" in result.unchanged)
		) {
			throw new ZoteroApiError(
				"Zotero item creation response omitted object 0",
				response.status,
			);
		}
		return { libraryVersion: parseLibraryVersion(response) };
	}

	async patchItem(
		prefix: string,
		itemKey: string,
		data: Record<string, unknown>,
		version: number,
		signal?: AbortSignal,
	) {
		return this.writeSingleItem(
			"PATCH",
			prefix,
			itemKey,
			data,
			version,
			signal,
		);
	}

	async deleteItem(
		prefix: string,
		itemKey: string,
		version: number,
		signal?: AbortSignal,
	) {
		return this.writeSingleItem(
			"DELETE",
			prefix,
			itemKey,
			undefined,
			version,
			signal,
		);
	}

	private async writeSingleItem(
		method: "DELETE" | "PATCH",
		prefix: string,
		itemKey: string,
		data: Record<string, unknown> | undefined,
		version: number,
		signal?: AbortSignal,
	) {
		if (!Number.isSafeInteger(version) || version < 0) {
			throw new ZoteroApiError(
				"Zotero item version must be non-negative",
			);
		}
		const response = await this.request(
			`${prefix}/items/${encodeURIComponent(itemKey)}`,
			undefined,
			{
				body: data === undefined ? undefined : JSON.stringify(data),
				headers: {
					...(data === undefined
						? {}
						: { "Content-Type": "application/json" }),
					"If-Unmodified-Since-Version": String(version),
				},
				method,
				signal,
			},
		);
		await response.body?.cancel();
		return { libraryVersion: parseLibraryVersion(response) };
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

	async downloadAttachment(
		prefix: string,
		itemKey: string,
		maxBytes: number,
	) {
		let response = await this.request(
			`${prefix}/items/${encodeURIComponent(itemKey)}/file`,
			undefined,
			{ accept: "application/pdf", redirect: "manual" },
		);
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (!location) {
				await response.body?.cancel();
				throw new ZoteroApiError(
					"Zotero attachment redirect omitted Location",
				);
			}
			const redirectUrl = new URL(
				location,
				response.url || this.options.apiBaseUrl,
			).toString();
			await response.body?.cancel();
			response = await this.request(redirectUrl, undefined, {
				accept: "application/pdf",
				apiHeaders: false,
			});
		}
		return {
			bytes: await readBoundedResponse(
				response,
				maxBytes,
				this.options.requestTimeoutMs,
				this.options.attachmentDownloadTimeoutMs ?? 120_000,
			),
			contentType: response.headers.get("content-type"),
			etag: response.headers.get("etag")?.replace(/^"|"$/gu, "") ?? null,
		};
	}
}
