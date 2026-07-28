import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import {
	AI_RATE_LIMIT_MAX_REQUESTS,
	AI_RATE_LIMIT_WINDOW_MS,
	AIRateLimiter,
} from "@/lib/ai-rate-limit";

function requestHeaders(address: string) {
	return new Headers({ "x-real-ip": address });
}

let limiter: AIRateLimiter;

beforeEach(() => {
	limiter = new AIRateLimiter();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("AI request rate limiting", () => {
	it("allows the configured request budget and rejects the next request", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-28T19:00:00.000Z"));
		const headers = requestHeaders("198.51.100.10");

		for (let request = 1; request <= AI_RATE_LIMIT_MAX_REQUESTS; request += 1) {
			expect(limiter.consume(headers)).toMatchObject({
				allowed: true,
				remaining: AI_RATE_LIMIT_MAX_REQUESTS - request,
			});
		}

		expect(limiter.consume(headers)).toMatchObject({
			allowed: false,
			remaining: 0,
			retryAfter: AI_RATE_LIMIT_WINDOW_MS / 1_000,
		});
		expect(limiter.getStatus(headers)).toMatchObject({
			remaining: 0,
			retryAfter: AI_RATE_LIMIT_WINDOW_MS / 1_000,
		});
	});

	it("isolates clients and resets an expired window", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-28T20:00:00.000Z"));
		const firstClient = requestHeaders("198.51.100.20");
		const secondClient = requestHeaders("198.51.100.21");

		expect(limiter.consume(firstClient).remaining).toBe(
			AI_RATE_LIMIT_MAX_REQUESTS - 1,
		);
		expect(limiter.getStatus(secondClient).remaining).toBe(
			AI_RATE_LIMIT_MAX_REQUESTS,
		);

		vi.advanceTimersByTime(AI_RATE_LIMIT_WINDOW_MS);

		expect(limiter.getStatus(firstClient).remaining).toBe(
			AI_RATE_LIMIT_MAX_REQUESTS,
		);
		expect(limiter.consume(firstClient)).toMatchObject({
			allowed: true,
			remaining: AI_RATE_LIMIT_MAX_REQUESTS - 1,
		});
	});

	it("ignores client-controlled forwarding headers", () => {
		const firstHeaders = new Headers({
			"x-forwarded-for": "203.0.113.40",
		});
		const secondHeaders = new Headers({
			"x-forwarded-for": "203.0.113.41",
		});

		expect(limiter.consume(firstHeaders)).toMatchObject({
			allowed: true,
			remaining: AI_RATE_LIMIT_MAX_REQUESTS - 1,
		});
		expect(limiter.getStatus(secondHeaders).remaining).toBe(
			AI_RATE_LIMIT_MAX_REQUESTS - 1,
		);
	});

	it("fails closed for new clients while every tracked bucket is live", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-28T21:00:00.000Z"));
		limiter = new AIRateLimiter({ maxTrackedClients: 2 });

		expect(limiter.consume(requestHeaders("198.51.100.30")).allowed).toBe(true);
		expect(limiter.consume(requestHeaders("198.51.100.31")).allowed).toBe(true);
		expect(limiter.consume(requestHeaders("198.51.100.32"))).toMatchObject({
			allowed: false,
			remaining: 0,
			retryAfter: AI_RATE_LIMIT_WINDOW_MS / 1_000,
		});
		expect(limiter.getStatus(requestHeaders("198.51.100.32"))).toMatchObject({
			allowed: false,
			remaining: 0,
			retryAfter: AI_RATE_LIMIT_WINDOW_MS / 1_000,
		});

		vi.advanceTimersByTime(AI_RATE_LIMIT_WINDOW_MS);

		expect(limiter.consume(requestHeaders("198.51.100.32"))).toMatchObject({
			allowed: true,
			remaining: AI_RATE_LIMIT_MAX_REQUESTS - 1,
		});
	});
});
