import {
	ClientRateLimiter,
	type ClientRateLimitStatus,
} from "./client-rate-limit";

export const AI_RATE_LIMIT_MAX_REQUESTS = 10;
export const AI_RATE_LIMIT_WINDOW_MS = 60_000;

type ClientHeaders = Pick<Headers, "get">;

export type AIRateLimitStatus = ClientRateLimitStatus;

type AIRateLimiterOptions = {
	maxTrackedClients?: number;
	now?: () => number;
};

export class AIRateLimiter extends ClientRateLimiter {
	constructor(options: AIRateLimiterOptions = {}) {
		super({
			maxRequests: AI_RATE_LIMIT_MAX_REQUESTS,
			maxTrackedClients: options.maxTrackedClients,
			now: options.now,
			windowMs: AI_RATE_LIMIT_WINDOW_MS,
		});
	}
}

const aiRateLimitGlobal = globalThis as typeof globalThis & {
	__evidenceLibraryAIRateLimiter?: AIRateLimiter;
};

const defaultAIRateLimiter =
	aiRateLimitGlobal.__evidenceLibraryAIRateLimiter ?? new AIRateLimiter();

aiRateLimitGlobal.__evidenceLibraryAIRateLimiter = defaultAIRateLimiter;

export function getAIRateLimitStatus(headers: ClientHeaders) {
	return defaultAIRateLimiter.getStatus(headers);
}

export function consumeAIRateLimit(headers: ClientHeaders) {
	return defaultAIRateLimiter.consume(headers);
}
