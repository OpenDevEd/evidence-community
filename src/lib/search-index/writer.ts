import type { SearchEngineName } from "@/config/library-config/schema";

import type { SearchProjectionPlan } from "./projection";

/**
 * Where the search worker writes a library's records, whichever engine the library searches (OpenDevEd/new-el#722).
 * The outbox consumer claims events, projects their records, and writes them through one of these; it doesn't know
 * the engine behind it.
 */

export type SearchWriteProgress = {
	batchProgress: number | null;
	batchUid: number | null;
	eventIds: number[];
	stage: "indexing" | "waiting";
	taskUid: number | null;
};

export type SearchWriteOptions = {
	maxDocumentBatchBytes: number;
	taskTimeoutMs: number;
	signal?: AbortSignal;
	/** The outbox events these writes are for, which progress names. */
	eventIds?: number[];
	onProgress?: (progress: SearchWriteProgress) => Promise<void>;
	/** Throws when the claim's leases were lost, so a long wait stops writing for events another worker now holds. */
	checkLease?: () => void;
	/**
	 * When the claim began reading its records, in milliseconds. Elasticsearch keeps each record as the latest read
	 * found it: claims run side by side, and one still embedding a record it read before a change must not overwrite
	 * the claim that read the change.
	 */
	readFrom?: number;
};

/** One claim's writes: plans as they are projected, then `finish`, after which readers find every change. */
export type SearchWriteBatch = {
	add(plan: SearchProjectionPlan): Promise<void>;
	finish(): Promise<void>;
};

export type SearchRebuildOptions = SearchWriteOptions & {
	/** The current projection of these records, to write again what the rebuild may have missed. */
	reproject: (keys: readonly string[]) => AsyncIterable<SearchProjectionPlan>;
};

export interface SearchIndexWriter {
	readonly engine: SearchEngineName;
	/**
	 * Makes sure the library has an index with this runtime's settings. `created` means it had none, so the index
	 * must be filled; `onMissing` runs before it is created.
	 */
	ensure(options: { onMissing?: () => Promise<void>; signal?: AbortSignal }): Promise<{ created: boolean }>;
	batch(options: SearchWriteOptions): SearchWriteBatch;
	/** Fills the library's index with every record. Readers keep finding the old records until it is complete. */
	rebuild(plans: AsyncIterable<SearchProjectionPlan>, options: SearchRebuildOptions): Promise<{ indexed: number; deleted: number }>;
	/** Deletes the library's index in this engine, after the library moved to another one. */
	remove(signal?: AbortSignal): Promise<void>;
}

/**
 * Records the engine refused for their content. Sending the same claim again can't succeed, so the claim is split
 * until the event behind the record is found and only that event retries.
 */
export class SearchIndexDocumentError extends Error {
	readonly failures: ReadonlyArray<{ key: string; reason: string }>;

	constructor(engine: string, failures: ReadonlyArray<{ key: string; reason: string }>) {
		super(
			`${engine} rejected ${failures.length || "some"} record(s)${failures.length ? ": " : ""}${failures
				.slice(0, 3)
				.map(({ key, reason }) => `${key}: ${reason}`)
				.join("; ")}`,
		);
		this.name = "SearchIndexDocumentError";
		this.failures = failures;
	}
}

/** A write the engine answered with a server-side or overload error; the claim retries. */
export class SearchIndexWriteError extends Error {
	constructor(engine: string, status: number | string, reason: string) {
		super(`${engine} could not write records (${status}): ${reason}`);
		this.name = "SearchIndexWriteError";
	}
}

export class SearchOutboxAbortError extends Error {
	constructor() {
		super("Search outbox processing was aborted");
		this.name = "SearchOutboxAbortError";
	}
}

export function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new SearchOutboxAbortError();
}

/** A promise that rejects with `SearchOutboxAbortError` as soon as `signal` aborts. */
export async function abortable<T>(promise: PromiseLike<T>, signal?: AbortSignal) {
	throwIfAborted(signal);
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new SearchOutboxAbortError());
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve(promise)
			.then(resolve, reject)
			.finally(() => {
				signal.removeEventListener("abort", abort);
			});
	});
}

export function validateMaxDocumentBatchBytes(maxDocumentBatchBytes: number) {
	if (!Number.isSafeInteger(maxDocumentBatchBytes) || maxDocumentBatchBytes < 1_024) {
		throw new Error("maxDocumentBatchBytes must be an integer of at least 1,024");
	}
}

/** Splits records into requests no larger than `maxBytes` of JSON; one larger record goes alone. */
export function chunkDocumentsBySerializedBytes(documents: SearchProjectionPlan["documents"], maxBytes: number) {
	const chunks: Array<SearchProjectionPlan["documents"]> = [];
	let chunk: SearchProjectionPlan["documents"] = [];
	let chunkBytes = 2;
	for (const document of documents) {
		const documentBytes = Buffer.byteLength(JSON.stringify(document), "utf8");
		const nextBytes = chunkBytes + documentBytes + (chunk.length > 0 ? 1 : 0);
		if (chunk.length > 0 && nextBytes > maxBytes) {
			chunks.push(chunk);
			chunk = [];
			chunkBytes = 2;
		}
		chunk.push(document);
		chunkBytes += documentBytes + (chunk.length > 1 ? 1 : 0);
	}
	if (chunk.length > 0) chunks.push(chunk);
	return chunks;
}
