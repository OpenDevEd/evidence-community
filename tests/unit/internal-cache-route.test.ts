import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: async () => config }));

import { POST } from "@/app/api/internal/cache/route";
import { cacheInvalidationToken } from "@/lib/cache-invalidation";

const hide = { tags: ["item:23456789"], immediate: true, reason: "1 item delete", source: "source-sync" };

function clear(authorization: string | null, body: unknown = hide) {
	return POST(new NextRequest("http://127.0.0.1:3000/api/internal/cache", {
		method: "POST",
		headers: authorization ? { authorization } : {},
		body: JSON.stringify(body),
	}));
}

beforeEach(() => revalidateTag.mockReset());

it("clears nothing for a caller without the library's token", async () => {
	expect((await clear(null)).status).toBe(401);
	expect((await clear("Bearer guessed")).status).toBe(401);
	expect(revalidateTag).not.toHaveBeenCalled();
});

it("expires a hidden record's tag at once for the web process's own reader", async () => {
	const response = await clear(`Bearer ${cacheInvalidationToken(config)}`);
	expect(response.status).toBe(200);
	expect(revalidateTag.mock.calls).toEqual([["item:23456789", { expire: 0 }]]);
});

it("refuses tags that no cached read uses", async () => {
	const response = await clear(`Bearer ${cacheInvalidationToken(config)}`, { ...hide, tags: ["_N_T_/layout"] });
	expect(response.status).toBe(400);
	expect(revalidateTag).not.toHaveBeenCalled();
});
