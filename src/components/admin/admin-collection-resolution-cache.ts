import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";

import { resolveAdminCollectionCatalog } from "./admin-api";

type ResolvedEntry = AdminCollectionCatalogEntry | null;

type PendingResolution = {
	generation: number;
	key: string;
	promise: Promise<ResolvedEntry>;
	reject: (error: unknown) => void;
	resolve: (entry: ResolvedEntry) => void;
	subscribers: number;
	task: ResolutionTask | null;
};

type ResolutionTask = {
	controller: AbortController | null;
	generation: number;
	resolutions: PendingResolution[];
};

const resolved = new Map<string, ResolvedEntry>();
const inFlight = new Map<string, PendingResolution>();
const queuedResolutions: PendingResolution[] = [];
const resolutionTasks: ResolutionTask[] = [];
const activeControllers = new Set<AbortController>();
const MAX_CACHE_ENTRIES = 2_000;
const MAX_CONCURRENT_REQUESTS = 3;
const RESOLUTION_BATCH_SIZE = 100;
let activeRequests = 0;
let flushScheduled = false;
let generation = 0;

function writeResolvedAdminCollection(key: string, entry: ResolvedEntry) {
	resolved.delete(key);
	resolved.set(key, entry);
	while (resolved.size > MAX_CACHE_ENTRIES) {
		const oldest = resolved.keys().next().value;
		if (oldest === undefined) break;
		resolved.delete(oldest);
	}
}

function rejectResolution(pending: PendingResolution, error: unknown) {
	if (inFlight.get(pending.key) === pending) {
		inFlight.delete(pending.key);
	}
	pending.reject(error);
}

function releaseResolution(pending: PendingResolution) {
	pending.subscribers = Math.max(0, pending.subscribers - 1);
	if (pending.subscribers > 0 || inFlight.get(pending.key) !== pending) {
		return;
	}
	inFlight.delete(pending.key);
	const task = pending.task;
	if (
		task?.controller &&
		task.resolutions.every(({ subscribers }) => subscribers === 0)
	) {
		task.controller.abort();
	}
}

function subscribeToResolution(key: string, signal?: AbortSignal) {
	const pending = queueResolution(key);
	pending.subscribers += 1;
	return new Promise<ResolvedEntry>((resolve, reject) => {
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			signal?.removeEventListener("abort", abort);
			releaseResolution(pending);
		};
		const abort = () => {
			release();
			reject(
				new DOMException(
					"Collection resolution aborted.",
					"AbortError",
				),
			);
		};
		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener("abort", abort, { once: true });
		void pending.promise.then(
			(entry) => {
				if (released) return;
				release();
				resolve(entry);
			},
			(error: unknown) => {
				if (released) return;
				release();
				reject(error);
			},
		);
	});
}

function drainResolutionTasks() {
	while (
		activeRequests < MAX_CONCURRENT_REQUESTS &&
		resolutionTasks.length > 0
	) {
		const task = resolutionTasks.shift()!;
		const current = task.resolutions.filter(
			(pending) =>
				pending.generation === generation &&
				inFlight.get(pending.key) === pending &&
				pending.subscribers > 0,
		);
		if (current.length === 0) continue;

		activeRequests += 1;
		const controller = new AbortController();
		task.controller = controller;
		for (const pending of current) pending.task = task;
		activeControllers.add(controller);
		void resolveAdminCollectionCatalog(
			current.map(({ key }) => key),
			controller.signal,
		)
			.then(({ items }) => {
				if (task.generation !== generation) {
					throw new Error("Collection resolution was invalidated.");
				}
				const itemsByKey = new Map(
					items.map((entry) => [entry.key, entry]),
				);
				for (const pending of current) {
					if (
						inFlight.get(pending.key) !== pending ||
						pending.subscribers === 0
					) {
						continue;
					}
					const entry = itemsByKey.get(pending.key) ?? null;
					writeResolvedAdminCollection(pending.key, entry);
					inFlight.delete(pending.key);
					pending.resolve(entry);
				}
			})
			.catch((error: unknown) => {
				for (const pending of current) {
					rejectResolution(pending, error);
				}
			})
			.finally(() => {
				activeControllers.delete(controller);
				task.controller = null;
				activeRequests -= 1;
				drainResolutionTasks();
			});
	}
}

function flushQueuedResolutions() {
	flushScheduled = false;
	const currentGeneration = generation;
	const current = queuedResolutions
		.splice(0)
		.filter(
			(pending) =>
				pending.generation === currentGeneration &&
				inFlight.get(pending.key) === pending &&
				pending.subscribers > 0,
		);
	for (
		let index = 0;
		index < current.length;
		index += RESOLUTION_BATCH_SIZE
	) {
		resolutionTasks.push({
			controller: null,
			generation: currentGeneration,
			resolutions: current.slice(index, index + RESOLUTION_BATCH_SIZE),
		});
	}
	drainResolutionTasks();
}

function queueResolution(key: string) {
	const existing = inFlight.get(key);
	if (existing) return existing;

	let resolve!: (entry: ResolvedEntry) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<ResolvedEntry>(
		(resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		},
	);
	const pending: PendingResolution = {
		generation,
		key,
		promise,
		reject,
		resolve,
		subscribers: 0,
		task: null,
	};
	inFlight.set(key, pending);
	queuedResolutions.push(pending);
	if (!flushScheduled) {
		flushScheduled = true;
		queueMicrotask(flushQueuedResolutions);
	}
	return pending;
}

/**
 * Forgets the collections already read, so the next ask reads them again, without stopping reads under way: stopped,
 * they fail, and what shows a collection's name would show it as missing for a moment.
 */
// ponytail: a read under way when someone renames a collection is reused, and can bring the old name; the next change reads it again.
export function forgetResolvedAdminCollections() {
	resolved.clear();
}

export function invalidateAdminCollectionResolutionCache() {
	generation += 1;
	resolved.clear();
	const error = new Error("Collection resolution was invalidated.");
	for (const pending of inFlight.values()) pending.reject(error);
	inFlight.clear();
	queuedResolutions.length = 0;
	resolutionTasks.length = 0;
	for (const controller of activeControllers) controller.abort();
}

/** A known entry without touching the cache's order, for reading during render. */
export const peekResolvedAdminCollection = (key: string) => resolved.get(key);

/** Entries a list or search already returned, so picking one shows it at once instead of waiting for a lookup. */
export function rememberAdminCollections(entries: readonly AdminCollectionCatalogEntry[]) {
	for (const entry of entries) writeResolvedAdminCollection(entry.key, entry);
}

export function readResolvedAdminCollection(key: string) {
	const entry = resolved.get(key);
	if (entry !== undefined) writeResolvedAdminCollection(key, entry);
	return entry;
}

export async function resolveAdminCollectionKeys(
	keys: readonly string[],
	signal?: AbortSignal,
) {
	const uniqueKeys = [...new Set(keys)];
	const entries = new Map<string, ResolvedEntry>();
	const requests = uniqueKeys.flatMap((key) => {
		const entry = readResolvedAdminCollection(key);
		if (entry !== undefined) {
			entries.set(key, entry);
			return [];
		}
		return [{ key, promise: subscribeToResolution(key, signal) }];
	});
	const settled = await Promise.allSettled(
		requests.map(({ promise }) => promise),
	);
	const failedKeys = new Set<string>();
	for (const [index, result] of settled.entries()) {
		const key = requests[index]!.key;
		if (result.status === "rejected") failedKeys.add(key);
		else entries.set(key, result.value);
	}
	return { entries, failedKeys };
}
