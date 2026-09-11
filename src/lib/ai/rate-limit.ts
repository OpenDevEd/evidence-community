import { createHash, randomUUID } from "node:crypto";
import { createClient } from "redis";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwareResourceFactory } from "@/lib/revision-aware-resource";

export const AI_RATE_LIMIT_COOKIE_NAME = "ai_rate_limit_id";
export const AI_RATE_LIMIT_COOKIE_PATH = "/api/ai";
export const AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const AI_RATE_LIMIT_KEY_PREFIX = "evidence-library:ai-rate-limit:v1";
const AI_RATE_LIMIT_DEPLOYMENT_NAMESPACE = "main";

export const AI_RATE_LIMIT_CLIENT_WINDOWS = [
	{ name: "minute", limit: 10, windowMs: 60 * 1_000 },
	{ name: "day", limit: 250, windowMs: 24 * 60 * 60 * 1_000 },
	{ name: "week", limit: 1_000, windowMs: 7 * 24 * 60 * 60 * 1_000 },
	{ name: "month", limit: 5_000, windowMs: 30 * 24 * 60 * 60 * 1_000 },
] as const;

export const AI_RATE_LIMIT_NETWORK_WINDOW = {
	name: "minute",
	limit: 1_000,
	windowMs: 60 * 1_000,
} as const;

const RATE_LIMIT_SCRIPT = `
local client_window_count = tonumber(ARGV[1])

local function count_and_ttl(key, window_ms)
  local count = tonumber(redis.call('GET', key) or '0')
  local ttl = redis.call('PTTL', key)
  if count > 0 and ttl < 0 then
    redis.call('PEXPIRE', key, window_ms)
    ttl = window_ms
  end
  return count, ttl
end

local blocked_index = 0
local blocked_count = 0
local blocked_ttl = -1

for index = 1, client_window_count do
  local argument_index = 2 + ((index - 1) * 2)
  local limit = tonumber(ARGV[argument_index])
  local window_ms = tonumber(ARGV[argument_index + 1])
  local count, ttl = count_and_ttl(KEYS[index], window_ms)
  if count >= limit and ttl > blocked_ttl then
    blocked_index = index
    blocked_count = count
    blocked_ttl = ttl
  end
end

local network_argument_index = 2 + (client_window_count * 2)
local network_limit = tonumber(ARGV[network_argument_index])
local network_window_ms = tonumber(ARGV[network_argument_index + 1])
local network_key_index = client_window_count + 1
local network_count, network_ttl = count_and_ttl(
  KEYS[network_key_index],
  network_window_ms
)
if network_count >= network_limit and network_ttl > blocked_ttl then
  blocked_index = network_key_index
  blocked_count = network_count
  blocked_ttl = network_ttl
end

if blocked_index > 0 then
  return {0, blocked_index, blocked_count, blocked_ttl}
end

local first_client_count = 0
local first_client_ttl = 0
for index = 1, client_window_count do
  local argument_index = 2 + ((index - 1) * 2)
  local window_ms = tonumber(ARGV[argument_index + 1])
  local count = redis.call('INCR', KEYS[index])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[index], window_ms)
  end
  if index == 1 then
    first_client_count = count
    first_client_ttl = redis.call('PTTL', KEYS[index])
  end
end

network_count = redis.call('INCR', KEYS[network_key_index])
if network_count == 1 then
  redis.call('PEXPIRE', KEYS[network_key_index], network_window_ms)
end

return {1, 0, first_client_count, first_client_ttl}
`;

type RedisEvalClient = {
	eval(
		script: string,
		options: { keys: string[]; arguments: string[] },
	): Promise<unknown>;
};

export type AIRateLimitIdentity = {
	clientId: string;
	clientIp: string;
	persistentClient: boolean;
};

export type AIRateLimitWindowName = "minute" | "day" | "week" | "month";

export type AIRateLimitWindow = {
	name: AIRateLimitWindowName;
	limit: number;
	windowMs: number;
};

export type AIRateLimitPolicy = {
	clientWindows: readonly AIRateLimitWindow[];
	networkWindow: AIRateLimitWindow;
	keyPrefix: string;
};

export type AIRateLimitResult = {
	allowed: boolean;
	blockedBy: "client" | "network" | null;
	window: AIRateLimitWindowName;
	limit: number;
	remaining: number;
	resetAt: number;
	retryAfter: number;
};

export type AIRateLimitClientIdentity = {
	clientId: string;
	shouldSetCookie: boolean;
};

class AIRateLimitUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AIRateLimitUnavailableError";
	}
}

function namespaceSegment(value: string, label: string) {
	const normalized = value.trim();
	if (!normalized) {
		throw new AIRateLimitUnavailableError(`${label} is not configured.`);
	}
	return encodeURIComponent(normalized);
}

export function buildAIRateLimitKeyPrefix(
	deploymentNamespace: string,
	tenantNamespace: string,
) {
	return [
		AI_RATE_LIMIT_KEY_PREFIX,
		namespaceSegment(
			deploymentNamespace,
			"AI rate-limit deployment namespace",
		),
		namespaceSegment(tenantNamespace, "AI rate-limit tenant namespace"),
	].join(":");
}

function isValidClientId(value: string | undefined): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			value,
		)
	);
}

export function resolveAIRateLimitClientIdentity(
	cookieValue: string | undefined,
): AIRateLimitClientIdentity {
	if (isValidClientId(cookieValue)) {
		return { clientId: cookieValue.toLowerCase(), shouldSetCookie: false };
	}

	return { clientId: randomUUID(), shouldSetCookie: true };
}

function rateLimitKey(
	prefix: string,
	scope: "client" | "network",
	window: AIRateLimitWindowName,
	value: string,
) {
	const digest = createHash("sha256").update(value).digest("base64url");
	return `${prefix}:${scope}:${window}:${digest}`;
}

function parseScriptReply(reply: unknown) {
	if (!Array.isArray(reply) || reply.length !== 4) {
		throw new Error("Redis returned an invalid AI rate-limit result.");
	}

	const values = reply.map((value) => Number(value));
	if (values.some((value) => !Number.isFinite(value))) {
		throw new Error("Redis returned a non-numeric AI rate-limit result.");
	}

	return values as [number, number, number, number];
}

export function createRedisAIRateLimitStore(
	redis: RedisEvalClient,
	policy: AIRateLimitPolicy,
) {
	return {
		async consume(
			identity: AIRateLimitIdentity,
		): Promise<AIRateLimitResult> {
			const clientWindows = identity.persistentClient
				? policy.clientWindows
				: policy.clientWindows.slice(0, 1);
			if (clientWindows.length === 0) {
				throw new Error(
					"At least one browser AI rate-limit window is required.",
				);
			}

			const reply = await redis.eval(RATE_LIMIT_SCRIPT, {
				keys: [
					...clientWindows.map((window) =>
						rateLimitKey(
							policy.keyPrefix,
							"client",
							window.name,
							identity.clientId,
						),
					),
					rateLimitKey(
						policy.keyPrefix,
						"network",
						policy.networkWindow.name,
						identity.clientIp,
					),
				],
				arguments: [
					String(clientWindows.length),
					...clientWindows.flatMap((window) => [
						String(window.limit),
						String(window.windowMs),
					]),
					String(policy.networkWindow.limit),
					String(policy.networkWindow.windowMs),
				],
			});
			const [allowedValue, blockedIndex, clientCount, ttlValue] =
				parseScriptReply(reply);
			const allowed = allowedValue === 1;
			const blockedBy = allowed
				? null
				: blockedIndex === clientWindows.length + 1
					? "network"
					: "client";
			const activeWindow =
				blockedBy === "network"
					? policy.networkWindow
					: (clientWindows[blockedIndex - 1] ?? clientWindows[0]);
			const ttl = Math.max(1, ttlValue);

			return {
				allowed,
				blockedBy,
				window: activeWindow.name,
				limit: activeWindow.limit,
				remaining: allowed
					? Math.max(0, activeWindow.limit - clientCount)
					: 0,
				resetAt: Date.now() + ttl,
				retryAfter: allowed ? 0 : Math.max(1, Math.ceil(ttl / 1_000)),
			};
		},
	};
}

function newRedisClient(url: string) {
	return createClient({
		url,
		disableOfflineQueue: true,
		commandsQueueMaxLength: 100,
		commandOptions: { timeout: 2_000 },
		socket: {
			connectTimeout: 1_000,
			reconnectStrategy: false,
		},
	});
}

type RedisClient = ReturnType<typeof newRedisClient>;

async function withRedisDeadline<T>(client: RedisClient, operation: () => Promise<T>): Promise<T> {
	// The client's command timeout covers its queue, not a reply after writing.
	const timeout = setTimeout(() => { if (client.isOpen) client.destroy(); }, 2_000);
	try {
		return await operation();
	} finally {
		clearTimeout(timeout);
	}
}


class RevisionAwareAIRateLimitRedis {
	readonly #factory = new RevisionAwareResourceFactory<string, () => Promise<RedisClient>>(
		"AI rate-limit Redis",
		(url) => {
			const client = newRedisClient(url);
			client.on("error", (error) => {
				console.error("[AI rate limit Redis]", error);
			});
			let connecting: Promise<unknown> | undefined;
			return {
				value: async () => {
					if (!client.isReady) {
						// Share one attempt; a later request can retry a closed connection.
						if (!connecting) {
							const timeout = setTimeout(() => { if (client.isOpen) client.destroy(); }, 2_000);
							connecting = client.connect().finally(() => {
								clearTimeout(timeout);
								connecting = undefined;
							});
						}
						await connecting;
					}
					return client;
				},
				dispose: async () => { if (client.isOpen) client.destroy(); },
			};
		},
	);

	async get(
		config: Pick<
			LibraryServerConfig,
			"revision" | "services" | "updatedAt"
		>,
	) {
		const url = config.services.redis?.url;
		if (!url) {
			throw new AIRateLimitUnavailableError(
				"The AI rate-limit Redis service is not configured.",
			);
		}
		const connect = await this.#factory.get({
			configuration: url,
			revision: config.revision,
			updatedAt: config.updatedAt,
		});
		return connect();
	}
}

const globalAIRateLimit = globalThis as typeof globalThis & {
	__evidenceLibraryAIRateLimitRedis?: RevisionAwareAIRateLimitRedis;
};

const redisForConfig =
	globalAIRateLimit.__evidenceLibraryAIRateLimitRedis ??
	new RevisionAwareAIRateLimitRedis();
globalAIRateLimit.__evidenceLibraryAIRateLimitRedis = redisForConfig;

export async function consumeConfiguredRateLimit(
  identity: AIRateLimitIdentity,
  config: Pick<LibraryServerConfig, "authentication" | "revision" | "services" | "updatedAt">,
  policy: AIRateLimitPolicy,
) {
  try {
    const redis = await redisForConfig.get(config);
    return await withRedisDeadline(redis, () => createRedisAIRateLimitStore(redis, policy).consume(identity));
  } catch (error) {
    if (error instanceof AIRateLimitUnavailableError) throw error;
    throw new AIRateLimitUnavailableError("The rate-limit service is unavailable.", { cause: error });
  }
}

export async function consumeAIRateLimit(
  identity: AIRateLimitIdentity,
  config: Pick<LibraryServerConfig, "authentication" | "revision" | "services" | "updatedAt">,
) {
  return consumeConfiguredRateLimit(identity, config, {
    clientWindows: AI_RATE_LIMIT_CLIENT_WINDOWS,
    networkWindow: AI_RATE_LIMIT_NETWORK_WINDOW,
    keyPrefix: buildAIRateLimitKeyPrefix(AI_RATE_LIMIT_DEPLOYMENT_NAMESPACE, config.authentication.openScholar.libraryId),
  });
}

export function aiRateLimitHeaders(result: AIRateLimitResult) {
	return {
		"X-RateLimit-Limit": String(result.limit),
		"X-RateLimit-Remaining": String(result.remaining),
		"X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000)),
		...(result.retryAfter > 0
			? { "Retry-After": String(result.retryAfter) }
			: {}),
	};
}
