export const AI_RATE_LIMIT_MAX_REQUESTS = 10;
export const AI_RATE_LIMIT_WINDOW_MS = 60_000;

const MAX_TRACKED_CLIENTS = 10_000;
const TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
const UNKNOWN_CLIENT = "unresolved-client";

type ClientHeaders = Pick<Headers, "get">;

type RateLimitBucket = {
	count: number;
	resetAt: number;
};

export type AIRateLimitStatus = {
	allowed: boolean;
	limit: number;
	remaining: number;
	resetAt: number;
	retryAfter: number;
};

type AIRateLimiterOptions = {
	maxTrackedClients?: number;
	now?: () => number;
};

function getClientIdentifier(headers: ClientHeaders) {
	const address = headers.get(TRUSTED_CLIENT_IP_HEADER)?.trim();
	if (!address || address.length > 128) return UNKNOWN_CLIENT;
	return address;
}

function retryAfterSeconds(resetAt: number, now: number) {
	return Math.max(0, Math.ceil((resetAt - now) / 1_000));
}

function availableStatus(now: number): AIRateLimitStatus {
	return {
		allowed: true,
		limit: AI_RATE_LIMIT_MAX_REQUESTS,
		remaining: AI_RATE_LIMIT_MAX_REQUESTS,
		resetAt: now + AI_RATE_LIMIT_WINDOW_MS,
		retryAfter: 0,
	};
}

function statusForBucket(
	bucket: RateLimitBucket | undefined,
	now: number,
): AIRateLimitStatus {
	if (!bucket || bucket.resetAt <= now) return availableStatus(now);

	return {
		allowed: bucket.count < AI_RATE_LIMIT_MAX_REQUESTS,
		limit: AI_RATE_LIMIT_MAX_REQUESTS,
		remaining: Math.max(0, AI_RATE_LIMIT_MAX_REQUESTS - bucket.count),
		resetAt: bucket.resetAt,
		retryAfter: retryAfterSeconds(bucket.resetAt, now),
	};
}

function saturatedStatus(
	resetAt: number,
	now: number,
): AIRateLimitStatus {
	return {
		allowed: false,
		limit: AI_RATE_LIMIT_MAX_REQUESTS,
		remaining: 0,
		resetAt,
		retryAfter: retryAfterSeconds(resetAt, now),
	};
}

export class AIRateLimiter {
	readonly #buckets = new Map<string, RateLimitBucket>();
	readonly #maxTrackedClients: number;
	readonly #now: () => number;

	constructor(options: AIRateLimiterOptions = {}) {
		this.#maxTrackedClients =
			options.maxTrackedClients ?? MAX_TRACKED_CLIENTS;
		this.#now = options.now ?? (() => Date.now());
	}

	getStatus(headers: ClientHeaders): AIRateLimitStatus {
		const now = this.#now();
		const identifier = getClientIdentifier(headers);
		let bucket = this.#buckets.get(identifier);

		if (bucket?.resetAt && bucket.resetAt <= now) {
			this.#buckets.delete(identifier);
			bucket = undefined;
		}

		if (!bucket) {
			const capacityResetAt = this.#capacityResetAt(now);
			if (capacityResetAt !== null) {
				return saturatedStatus(capacityResetAt, now);
			}
		}

		return statusForBucket(bucket, now);
	}

	consume(headers: ClientHeaders): AIRateLimitStatus {
		const now = this.#now();
		const identifier = getClientIdentifier(headers);
		const current = this.#buckets.get(identifier);

		if (!current || current.resetAt <= now) {
			if (!current) {
				const capacityResetAt = this.#capacityResetAt(now);
				if (capacityResetAt !== null) {
					return saturatedStatus(capacityResetAt, now);
				}
			}

			const bucket = {
				count: 1,
				resetAt: now + AI_RATE_LIMIT_WINDOW_MS,
			};
			this.#buckets.set(identifier, bucket);
			return {
				...statusForBucket(bucket, now),
				allowed: true,
			};
		}

		if (current.count >= AI_RATE_LIMIT_MAX_REQUESTS) {
			return statusForBucket(current, now);
		}

		current.count += 1;
		return {
			...statusForBucket(current, now),
			allowed: true,
		};
	}

	#capacityResetAt(now: number) {
		let earliestResetAt = Number.POSITIVE_INFINITY;

		for (const [identifier, bucket] of this.#buckets) {
			if (bucket.resetAt <= now) {
				this.#buckets.delete(identifier);
				continue;
			}
			earliestResetAt = Math.min(earliestResetAt, bucket.resetAt);
		}

		if (this.#buckets.size < this.#maxTrackedClients) return null;
		return earliestResetAt;
	}
}

const aiRateLimitGlobal = globalThis as typeof globalThis & {
	__evidenceLibraryAIRateLimiter?: AIRateLimiter;
};

const defaultAIRateLimiter =
	aiRateLimitGlobal.__evidenceLibraryAIRateLimiter ??
	new AIRateLimiter();

aiRateLimitGlobal.__evidenceLibraryAIRateLimiter =
	defaultAIRateLimiter;

export function getAIRateLimitStatus(headers: ClientHeaders) {
	return defaultAIRateLimiter.getStatus(headers);
}

export function consumeAIRateLimit(headers: ClientHeaders) {
	return defaultAIRateLimiter.consume(headers);
}
