import { setTimeout as delay } from "node:timers/promises";

import { revalidateTag } from "next/cache";
import { createClient } from "redis";

import { loadLibraryConfig } from "@/config/library-config/source";
import {
	CACHE_INVALIDATION_STREAM,
	cacheInvalidationToken,
	type CacheInvalidation,
} from "@/lib/cache-invalidation";

const READ_BLOCK_MS = 10_000;
const RETRY_MS = 2_000;
const CACHE_CLEARING_PATH = "/api/internal/cache";

function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

/** Needs a request context: call it from a route handler or server function. */
export function clearCacheTags(invalidation: CacheInvalidation) {
	const profile = invalidation.immediate ? { expire: 0 } : "max";
	for (const tag of invalidation.tags) revalidateTag(tag, profile);
	console.info("[cache] Cleared", JSON.stringify(invalidation));
}

/**
 * `revalidateTag` works only inside a request, so each stream entry is handed
 * to the clearing route on this same server.
 */
async function clearThroughLocalRoute(id: string, event: string) {
	const port = process.env.PORT ?? "3000";
	for (;;) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}${CACHE_CLEARING_PATH}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${cacheInvalidationToken(await loadLibraryConfig())}`,
					"content-type": "application/json",
				},
				body: event,
			});
			if (response.ok) return;
			// A rejected entry never becomes valid; skip it so later clears still arrive.
			if (response.status === 400) {
				console.error("[cache] Skipped an invalid stream entry", JSON.stringify({ id, event }));
				return;
			}
			throw new Error(`Clearing route answered ${response.status}`);
		} catch (error) {
			// The server may still be starting; keep the entry until it is cleared.
			console.error("[cache] Clearing a stream entry failed; retrying", JSON.stringify({ id, event, error: errorText(error) }));
			await delay(RETRY_MS);
		}
	}
}

async function openStream(url: string) {
	const client = createClient({
		url,
		socket: { connectTimeout: 5_000, socketTimeout: READ_BLOCK_MS * 3, reconnectStrategy: false },
	});
	client.on("error", () => {});
	await client.connect();
	return client;
}

type StreamClient = Awaited<ReturnType<typeof openStream>>;

async function newestEntryId(client: StreamClient) {
	const [newest] = await client.xRevRange(CACHE_INVALIDATION_STREAM, "+", "-", { COUNT: 1 });
	return newest?.id ?? "0-0";
}

/** Clears each entry after `position.lastId` as it arrives, until the connection fails. */
async function clearArrivingEntries(client: StreamClient, position: { lastId: string }) {
	for (;;) {
		const reply = (await client.xRead(
			{ key: CACHE_INVALIDATION_STREAM, id: position.lastId },
			{ BLOCK: READ_BLOCK_MS, COUNT: 100 },
		)) as Array<{ messages: Array<{ id: string; message: Record<string, string> }> }> | null;
		for (const { id, message } of reply?.flatMap((stream) => stream.messages) ?? []) {
			console.info("[cache] Received", JSON.stringify({ id, event: message.event }));
			await clearThroughLocalRoute(id, message.event ?? "");
			position.lastId = id;
		}
	}
}

/**
 * Runs for the life of the web process. It starts after the newest entry,
 * because a restarted process starts with an empty cache, and resumes from the
 * last entry it handled after losing Redis, so a short outage loses nothing.
 * The signal only stops it in tests.
 */
export async function consumeCacheInvalidations(signal?: AbortSignal) {
	let position: { lastId: string } | undefined;
	while (!signal?.aborted) {
		let client: StreamClient | undefined;
		let retryMs = RETRY_MS;
		const stop = () => void (client?.isOpen && client.destroy());
		signal?.addEventListener("abort", stop, { once: true });
		try {
			const url = (await loadLibraryConfig()).services.redis?.url;
			if (!url) {
				retryMs = 60_000;
				throw new Error("No Redis configured; item pages read the database on every visit");
			}
			client = await openStream(url);
			const resuming = position !== undefined;
			position ??= { lastId: await newestEntryId(client) };
			console.info(resuming ? "[cache] Reconnected to Redis; resuming cache clears" : "[cache] Reading cache clears", JSON.stringify({ from: position.lastId }));
			await clearArrivingEntries(client, position);
		} catch (error) {
			if (!signal?.aborted) console.error("[cache] Lost the cache clearing stream; reconnecting", JSON.stringify({ from: position?.lastId, error: errorText(error) }));
		} finally {
			signal?.removeEventListener("abort", stop);
			stop();
		}
		await delay(retryMs, undefined, { signal }).catch(() => undefined);
	}
}
