import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	AI_RATE_LIMIT_CLIENT_WINDOWS,
	AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS,
	AI_RATE_LIMIT_NETWORK_WINDOW,
	aiRateLimitHeaders,
	buildAIRateLimitKeyPrefix,
	createRedisAIRateLimitStore,
	resolveAIRateLimitClientIdentity,
	type AIRateLimitPolicy,
} from "@/lib/ai/rate-limit";

const policy: AIRateLimitPolicy = {
	clientWindows: AI_RATE_LIMIT_CLIENT_WINDOWS,
	networkWindow: AI_RATE_LIMIT_NETWORK_WINDOW,
	keyPrefix: buildAIRateLimitKeyPrefix("main", "library-one"),
};

describe("AI request rate-limit policy", () => {
	it("defines the browser and network quotas", () => {
		expect(AI_RATE_LIMIT_CLIENT_WINDOWS).toEqual([
			{ name: "minute", limit: 10, windowMs: 60_000 },
			{ name: "day", limit: 250, windowMs: 86_400_000 },
			{ name: "week", limit: 1_000, windowMs: 604_800_000 },
			{ name: "month", limit: 5_000, windowMs: 2_592_000_000 },
		]);
		expect(AI_RATE_LIMIT_NETWORK_WINDOW).toEqual({
			name: "minute",
			limit: 1_000,
			windowMs: 60_000,
		});
		expect(AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000);
	});

	it("separates deployment and library counters", () => {
		const mainLibrary = buildAIRateLimitKeyPrefix("main", "library-one");

		expect(mainLibrary).toBe(
			"evidence-library:ai-rate-limit:v1:main:library-one",
		);
		expect(mainLibrary).not.toBe(
			buildAIRateLimitKeyPrefix("main", "library-two"),
		);
		expect(mainLibrary).not.toBe(
			buildAIRateLimitKeyPrefix("acceptance", "library-one"),
		);
	});

	it("keeps a valid browser identity and replaces invalid values", () => {
		const created = resolveAIRateLimitClientIdentity(undefined);
		expect(created.shouldSetCookie).toBe(true);
		expect(created.clientId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
		);
		expect(resolveAIRateLimitClientIdentity(created.clientId)).toEqual({
			clientId: created.clientId,
			shouldSetCookie: false,
		});
		expect(
			resolveAIRateLimitClientIdentity("not-a-browser-id"),
		).toMatchObject({
			shouldSetCookie: true,
		});
	});

	it("sends one atomic Redis operation without exposing raw identities", async () => {
		const calls: Array<{ keys: string[]; arguments: string[] }> = [];
		const store = createRedisAIRateLimitStore(
			{
				eval: async (_script, options) => {
					calls.push(options);
					return [1, 0, 1, 60_000];
				},
			},
			policy,
		);

		await expect(
			store.consume({
				clientId: "00000000-0000-4000-8000-000000000001",
				clientIp: "198.51.100.20",
				persistentClient: true,
			}),
		).resolves.toMatchObject({
			allowed: true,
			blockedBy: null,
			limit: 10,
			remaining: 9,
			window: "minute",
		});

		const [options] = calls;
		if (!options) throw new Error("Redis eval was not called");
		expect(options.keys).toHaveLength(5);
		expect(options.arguments).toEqual([
			"4",
			"10",
			"60000",
			"250",
			"86400000",
			"1000",
			"604800000",
			"5000",
			"2592000000",
			"1000",
			"60000",
		]);
		expect(options.keys.join(" ")).not.toContain("198.51.100.20");
		expect(options.keys.join(" ")).not.toContain("00000000-0000");
	});

	it("reports the client window Redis blocked", async () => {
		const store = createRedisAIRateLimitStore(
			{ eval: vi.fn(async () => [0, 2, 250, 1_250]) },
			policy,
		);

		const result = await store.consume({
			clientId: "client",
			clientIp: "ip",
			persistentClient: true,
		});
		expect(result).toMatchObject({
			allowed: false,
			blockedBy: "client",
			limit: 250,
			remaining: 0,
			retryAfter: 2,
			window: "day",
		});
		expect(aiRateLimitHeaders(result)).toMatchObject({
			"Retry-After": "2",
			"X-RateLimit-Limit": "250",
			"X-RateLimit-Remaining": "0",
		});
	});

	it("reports the separate network safety limit", async () => {
		const store = createRedisAIRateLimitStore(
			{ eval: vi.fn(async () => [0, 5, 1_000, 900]) },
			policy,
		);

		await expect(
			store.consume({
				clientId: "client",
				clientIp: "ip",
				persistentClient: true,
			}),
		).resolves.toMatchObject({
			allowed: false,
			blockedBy: "network",
			limit: 1_000,
			window: "minute",
		});
	});

	it("rejects a malformed Redis reply", async () => {
		const store = createRedisAIRateLimitStore(
			{ eval: vi.fn(async () => [1, 0]) },
			policy,
		);

		await expect(
			store.consume({
				clientId: "client",
				clientIp: "ip",
				persistentClient: true,
			}),
		).rejects.toThrow("invalid AI rate-limit result");
	});

	it("does not create long-lived counters before the browser cookie returns", async () => {
		const calls: Array<{ keys: string[]; arguments: string[] }> = [];
		const store = createRedisAIRateLimitStore(
			{
				eval: async (_script, options) => {
					calls.push(options);
					return [1, 0, 1, 60_000];
				},
			},
			policy,
		);

		await store.consume({
			clientId: "new-client",
			clientIp: "198.51.100.20",
			persistentClient: false,
		});

		expect(calls[0]?.keys).toHaveLength(2);
		expect(calls[0]?.arguments).toEqual([
			"1",
			"10",
			"60000",
			"1000",
			"60000",
		]);
	});
});
