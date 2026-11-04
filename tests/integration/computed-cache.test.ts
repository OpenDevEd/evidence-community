import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("@/db", () => ({ getDatabaseForConfig: vi.fn() }));

import { getDatabaseForConfig } from "@/db";
import { computedCache } from "@/db/schema/tables/computedCache";
import { peekComputedCache, withComputedCache } from "@/lib/cache-utils";

// The database comes from the mocked `getDatabaseForConfig`, so the configuration itself is never read.
const config = {} as Parameters<typeof withComputedCache>[0];

it("saves computed values and never replaces a newer one another process saved", async () => {
	await withIsolatedPublicationDatabase(async (database) => {
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		const saved = async (key: string) =>
			(await database.select({ value: computedCache.value }).from(computedCache).where(eq(computedCache.key, key)))[0]?.value;

		const fresh = `statistics-${randomUUID()}`;
		expect(await withComputedCache(config, fresh, async () => ({ count: 1 }))).toEqual({ count: 1 });
		expect(await saved(fresh)).toEqual({ count: 1 });

		const raced = `statistics-${randomUUID()}`;
		const result = await withComputedCache(config, raced, async () => {
			// Another process finishes a newer value while this one is still computing.
			await database.insert(computedCache).values({ key: raced, value: { count: 3 }, computedAt: new Date(Date.now() + 60_000) });
			return { count: 2 };
		});
		expect(result).toEqual({ count: 2 });
		expect(await saved(raced)).toEqual({ count: 3 });
	});
});

it("replaces a saved value older than its age limit with a fresh one", async () => {
	await withIsolatedPublicationDatabase(async (database) => {
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		const key = `statistics-${randomUUID()}`;
		await database.insert(computedCache).values({ key, value: { count: 1 }, computedAt: new Date(Date.now() - 2 * 86_400_000) });
		// The old value answers at once while the fresh one is computed and saved behind it.
		expect(await peekComputedCache(config, key, async () => ({ count: 2 }), { maxAgeMs: 60_000 })).toEqual({ count: 1 });
		await vi.waitFor(async () => {
			const [row] = await database.select({ value: computedCache.value }).from(computedCache).where(eq(computedCache.key, key));
			expect(row?.value).toEqual({ count: 2 });
		});
	});
});
