// Anyone may hand records to OpenScholar, so the proxy holds each visitor to the AI request windows (src/proxy.ts).
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/middleware", () => ({ default: () => () => NextResponse.next() }));
const mocks = vi.hoisted(() => ({ loadLibraryConfig: vi.fn(), consume: vi.fn() }));
vi.mock("@/config/library-config/source", () => ({ loadLibraryConfig: mocks.loadLibraryConfig }));
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: vi.fn() }));
vi.mock("@/lib/ai/rate-limit", async (original) => ({ ...(await original<typeof import("@/lib/ai/rate-limit")>()), consumeAIRateLimit: mocks.consume }));

import proxy from "@/proxy";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

const handOff = () => proxy(new NextRequest("http://localhost/api/handoff", { method: "POST", body: "{}" }));
const used = { allowed: false, blockedBy: "client", window: "minute", limit: 10, remaining: 0, resetAt: Date.now() + 30_000, retryAfter: 30 };

beforeEach(() => {
	mocks.consume.mockReset().mockResolvedValue(used);
});

it("refuses a visitor's hand-off once their request windows are used up", async () => {
	const config = libraryConfigSchema.parse(structuredClone(minimalLibraryConfig));
	mocks.loadLibraryConfig.mockResolvedValue({ ...config, features: { ...config.features, ai: false } });
	expect(config.services.redis).toBeDefined();

	expect((await handOff()).status).toBe(429);
	expect(mocks.consume).toHaveBeenCalledOnce();
});

it("lets hand-offs through where the library keeps no request windows", async () => {
	const config = libraryConfigSchema.parse(structuredClone(minimalLibraryConfig));
	mocks.loadLibraryConfig.mockResolvedValue({ ...config, features: { ...config.features, ai: false }, services: { ...config.services, redis: undefined } });

	expect((await handOff()).status).not.toBe(429);
	expect(mocks.consume).not.toHaveBeenCalled();
});
