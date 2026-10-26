import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("@/db", () => ({ getDatabaseForConfig: vi.fn() }));

import { getDatabaseForConfig } from "@/db";
import { computedCache } from "@/db/schema/tables/computedCache";
import { withComputedCache } from "@/lib/cache-utils";

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
