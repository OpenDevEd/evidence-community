import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, it, vi } from "vitest";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const redisUrl = process.env.REDIS_URL;
const config = libraryConfigSchema.parse(maximalLibraryConfig);
config.services.redis = { url: redisUrl ?? "redis://127.0.0.1:1" };

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/source", () => ({ loadLibraryConfig: async () => config }));

import { insertOutboxEvents } from "@/db/postgres";
import {
	createNativeItemDraft,
	publishItemDraftWithContext,
	unpublishNativeItemWithOutcome,
} from "@/lib/admin/native-item-service";
import { consumeCacheInvalidations } from "@/lib/cache-clearing";
import { cacheInvalidationToken, publishOutboxCommits } from "@/lib/cache-invalidation";

it("hands each record change a writer process commits to the web process's clearing route", async () => {
	if (!redisUrl) throw new Error("REDIS_URL is required");
	// Stands in for the web server's /api/internal/cache route.
	const received: Array<{ authorization?: string; event: unknown }> = [];
	const route = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		received.push({ authorization: request.headers.authorization, event: JSON.parse(body) });
		response.end("{}");
	});
	route.listen(0, "127.0.0.1");
	await once(route, "listening");
	process.env.PORT = String((route.address() as AddressInfo).port);
	const started = vi.spyOn(console, "info");
	const reader = new AbortController();
	const reading = consumeCacheInvalidations(reader.signal);
	try {
		// The reader skips entries older than its start, so wait until it is listening.
		await expect.poll(() => started.mock.calls.some(([message]) => message === "[cache] Reading cache clears")).toBe(true);
		await withIsolatedPublicationDatabase(async (database) => {
			const { itemKey } = await createNativeItemDraft(database, { itemType: "Report", title: "Cached report" });
			// Review approval publishes inside the reviewer's transaction, one savepoint down.
			await database.transaction((transaction) => publishItemDraftWithContext(transaction, itemKey));
			await expect(database.transaction(async (transaction) => {
				await insertOutboxEvents(transaction, { entityType: "collection", entityKey: "ROLLBACK", operation: "upsert", revision: 1 });
				throw new Error("rolled back");
			})).rejects.toThrow("rolled back");
			await unpublishNativeItemWithOutcome(database, itemKey);

			const authorization = `Bearer ${cacheInvalidationToken(config)}`;
			await expect.poll(() => received).toEqual([
				{ authorization, event: { tags: [`item:${itemKey}`], immediate: true, reason: "1 item upsert", source: "source-sync" } },
				{ authorization, event: { tags: [`item:${itemKey}`], immediate: true, reason: "1 item delete", source: "source-sync" } },
			]);
		}, publishOutboxCommits(config, "source-sync"));
	} finally {
		reader.abort();
		await reading;
		route.close();
		started.mockRestore();
	}
}, 60_000);
