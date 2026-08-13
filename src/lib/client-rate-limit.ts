export type ClientRateLimitStatus = {
	allowed: boolean;
	limit: number;
	remaining: number;
	resetAt: number;
	retryAfter: number;
};

type RateLimitBucket = {
	count: number;
	resetAt: number;
};

type ClientHeaders = Pick<Headers, "get">;

type ClientRateLimiterOptions = {
	maxRequests: number;
	windowMs: number;
	maxTrackedClients?: number;
	now?: () => number;
};

const TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
const UNKNOWN_CLIENT = "unresolved-client";

function getClientIdentifier(headers: ClientHeaders) {
	const address = headers.get(TRUSTED_CLIENT_IP_HEADER)?.trim();
	if (!address || address.length > 128) return UNKNOWN_CLIENT;
	return address;
}

export class ClientRateLimiter {
	readonly #buckets = new Map<string, RateLimitBucket>();
	readonly #maxRequests: number;
	readonly #windowMs: number;
	readonly #maxTrackedClients: number;
	readonly #now: () => number;

	constructor(options: ClientRateLimiterOptions) {
		this.#maxRequests = options.maxRequests;
		this.#windowMs = options.windowMs;
		this.#maxTrackedClients = options.maxTrackedClients ?? 10_000;
		this.#now = options.now ?? (() => Date.now());
	}

	getStatus(headers: ClientHeaders): ClientRateLimitStatus {
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
				return this.#saturatedStatus(capacityResetAt, now);
			}
		}

		return this.#statusForBucket(bucket, now);
	}

	consume(headers: ClientHeaders): ClientRateLimitStatus {
		const now = this.#now();
		const identifier = getClientIdentifier(headers);
		const current = this.#buckets.get(identifier);

		if (!current || current.resetAt <= now) {
			if (!current) {
				const capacityResetAt = this.#capacityResetAt(now);
				if (capacityResetAt !== null) {
					return this.#saturatedStatus(capacityResetAt, now);
				}
			}

			const bucket = { count: 1, resetAt: now + this.#windowMs };
			this.#buckets.set(identifier, bucket);
			return { ...this.#statusForBucket(bucket, now), allowed: true };
		}

		if (current.count >= this.#maxRequests) {
			return this.#statusForBucket(current, now);
		}

		current.count += 1;
		return { ...this.#statusForBucket(current, now), allowed: true };
	}

	reset(headers: ClientHeaders) {
		this.#buckets.delete(getClientIdentifier(headers));
	}

	#statusForBucket(
		bucket: RateLimitBucket | undefined,
		now: number,
	): ClientRateLimitStatus {
		if (!bucket || bucket.resetAt <= now) {
			return {
				allowed: true,
				limit: this.#maxRequests,
				remaining: this.#maxRequests,
				resetAt: now + this.#windowMs,
				retryAfter: 0,
			};
		}
		return {
			allowed: bucket.count < this.#maxRequests,
			limit: this.#maxRequests,
			remaining: Math.max(0, this.#maxRequests - bucket.count),
			resetAt: bucket.resetAt,
			retryAfter: Math.max(0, Math.ceil((bucket.resetAt - now) / 1_000)),
		};
	}

	#saturatedStatus(resetAt: number, now: number): ClientRateLimitStatus {
		return {
			allowed: false,
			limit: this.#maxRequests,
			remaining: 0,
			resetAt,
			retryAfter: Math.max(0, Math.ceil((resetAt - now) / 1_000)),
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
		return this.#buckets.size < this.#maxTrackedClients
			? null
			: earliestResetAt;
	}
}
