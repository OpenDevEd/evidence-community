const WINDOW_MS = 60_000;
const LIMIT = 10;

type RateLimitEntry = {
	count: number;
	resetAt: number;
};

type RateLimitState = typeof globalThis & {
	__openDevedAIRateLimits?: Map<string, RateLimitEntry>;
	__openDevedAIRateLimitChecks?: number;
};

const state = globalThis as RateLimitState;
const entries = state.__openDevedAIRateLimits ?? new Map<string, RateLimitEntry>();
state.__openDevedAIRateLimits = entries;

export type AIRateLimitResult = {
	allowed: boolean;
	limit: number;
	remaining: number;
	resetAt: number;
	retryAfter: number;
};

function cleanupExpiredEntries(now: number) {
	state.__openDevedAIRateLimitChecks =
		(state.__openDevedAIRateLimitChecks ?? 0) + 1;
	if (state.__openDevedAIRateLimitChecks % 100 !== 0) return;

	for (const [ip, entry] of entries) {
		if (entry.resetAt <= now) entries.delete(ip);
	}
}

export function consumeAIRateLimit(ip: string, now = Date.now()): AIRateLimitResult {
	cleanupExpiredEntries(now);

	const current = entries.get(ip);
	const entry =
		!current || current.resetAt <= now
			? { count: 0, resetAt: now + WINDOW_MS }
			: current;

	if (entry.count >= LIMIT) {
		return {
			allowed: false,
			limit: LIMIT,
			remaining: 0,
			resetAt: entry.resetAt,
			retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
		};
	}

	entry.count += 1;
	entries.set(ip, entry);

	return {
		allowed: true,
		limit: LIMIT,
		remaining: Math.max(0, LIMIT - entry.count),
		resetAt: entry.resetAt,
		retryAfter: 0,
	};
}

export function aiRateLimitHeaders(result: AIRateLimitResult) {
	return {
		"X-RateLimit-Limit": String(result.limit),
		"X-RateLimit-Remaining": String(result.remaining),
		"X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
		...(result.retryAfter > 0
			? { "Retry-After": String(result.retryAfter) }
			: {}),
	};
}

