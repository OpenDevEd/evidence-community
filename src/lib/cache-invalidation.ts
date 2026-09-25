import { createHmac } from "node:crypto";

import { createClient } from "redis";
import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";

/** Every process that changes public records adds an entry here; the web process reads it and clears the matching cached pages. */
export const CACHE_INVALIDATION_STREAM = "evidence-library:cache-invalidation:v1";
const STREAM_MAX_LENGTH = 10_000;
const PUBLISH_DEADLINE_MS = 2_000;

export const cacheInvalidationSchema = z
	.object({
		tags: z.array(z.string().regex(/^(item:[A-Za-z0-9]{1,8}|collections|library)$/u)).min(1),
		immediate: z.boolean(),
		reason: z.string().max(500),
		source: z.string().max(200),
	})
	.strict();

export type CacheInvalidation = z.infer<typeof cacheInvalidationSchema>;

export type OutboxEvent = {
	entityType: "item" | "collection";
	entityKey: string;
	operation: "upsert" | "delete";
};

/**
 * Writers already record an outbox row for the record, its parent and any
 * collection they change, so the rows name every cached page to clear.
 * Item changes clear at once: a row cannot tell a hidden tag or an unpublished
 * file apart from an ordinary edit, and a stale page could show removed data.
 */
export function cacheInvalidationForOutbox(
	events: readonly OutboxEvent[],
	source: string,
): CacheInvalidation {
	const tags = new Set<string>();
	const counts = new Map<string, number>();
	for (const event of events) {
		tags.add(event.entityType === "item" ? `item:${event.entityKey}` : "collections");
		const label = `${event.entityType} ${event.operation}`;
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return {
		tags: [...tags],
		immediate: events.some(
			(event) => event.entityType === "item" || event.operation === "delete",
		),
		reason: [...counts].map(([label, count]) => `${count} ${label}`).join(", "),
		source,
	};
}

/** The web process's local clearing route accepts only this token, derived from the library's own secret. */
export function cacheInvalidationToken(
	config: Pick<LibraryServerConfig, "authentication">,
) {
	return createHmac("sha256", config.authentication.secret)
		.update(CACHE_INVALIDATION_STREAM)
		.digest("base64url");
}

async function withDeadline<T>(work: Promise<T>, milliseconds: number) {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Timed out after ${milliseconds} ms`)),
					milliseconds,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Never throws: the database change is already committed, so a failure is logged with everything needed to repeat it. */
export async function publishCacheInvalidation(
	config: Pick<LibraryServerConfig, "services">,
	invalidation: CacheInvalidation,
) {
	const url = config.services.redis?.url;
	// Without Redis nothing is cached (see getCachedItemSmall), so there is nothing to clear.
	if (!url) return;
	// ponytail: one connection per publish; keep a client open if publishes become frequent.
	const client = createClient({
		url,
		socket: { connectTimeout: PUBLISH_DEADLINE_MS, reconnectStrategy: false },
	});
	client.on("error", () => {});
	try {
		await withDeadline(
			(async () => {
				await client.connect();
				await client.xAdd(
					CACHE_INVALIDATION_STREAM,
					"*",
					{ event: JSON.stringify(invalidation) },
					{ TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STREAM_MAX_LENGTH } },
				);
			})(),
			PUBLISH_DEADLINE_MS,
		);
	} catch (error) {
		console.error("[cache] Publishing a cache clear failed; clear these tags by hand if the pages look stale", JSON.stringify({
			...invalidation,
			error: error instanceof Error ? error.message : String(error),
		}));
	} finally {
		if (client.isOpen) client.destroy();
	}
}

/** The after-commit hook for worker processes, whose library config is fixed for the life of the process. */
export function publishOutboxCommits(
	config: Pick<LibraryServerConfig, "services">,
	source: string,
) {
	return (events: OutboxEvent[]) =>
		publishCacheInvalidation(config, cacheInvalidationForOutbox(events, source));
}
