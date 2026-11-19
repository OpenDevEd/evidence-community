import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "redis";
import {
	AI_RATE_LIMIT_CLIENT_WINDOWS,
	AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS,
	buildAIRateLimitKeyPrefix,
	createRedisAIRateLimitStore,
	resolveAIRateLimitClientIdentity,
} from "./rate-limit";

test("AI rate-limit policy includes minute, daily, weekly, and monthly browser quotas", () => {
	assert.deepEqual(AI_RATE_LIMIT_CLIENT_WINDOWS, [
		{ name: "minute", limit: 10, windowMs: 60_000 },
		{ name: "day", limit: 250, windowMs: 86_400_000 },
		{ name: "week", limit: 1_000, windowMs: 604_800_000 },
		{ name: "month", limit: 5_000, windowMs: 2_592_000_000 },
	]);
	assert.equal(AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS, 31_536_000);
});

test("AI rate-limit keys separate deployments and libraries", () => {
	const coolifyEkitabu = buildAIRateLimitKeyPrefix("coolify", "itemsEkitabu");

	assert.equal(
		coolifyEkitabu,
		"evidence-library:ai-rate-limit:v1:coolify:itemsEkitabu",
	);
	assert.notEqual(
		coolifyEkitabu,
		buildAIRateLimitKeyPrefix("main", "itemsEkitabu"),
	);
	assert.notEqual(
		coolifyEkitabu,
		buildAIRateLimitKeyPrefix("coolify", "itemsUSAID"),
	);
});

test("the AI rate-limit browser identity is stable and replaces invalid values", () => {
	const created = resolveAIRateLimitClientIdentity(undefined);
	assert.equal(created.shouldSetCookie, true);
	assert.match(
		created.clientId,
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);

	assert.deepEqual(resolveAIRateLimitClientIdentity(created.clientId), {
		clientId: created.clientId,
		shouldSetCookie: false,
	});
	assert.equal(
		resolveAIRateLimitClientIdentity("visitor-chosen-value")
			.shouldSetCookie,
		true,
	);
});

const redisUrl = process.env.AI_RATE_LIMIT_TEST_REDIS_URL?.trim();

test(
	"Redis gives browsers on one network separate budgets shared by every app instance",
	{ skip: redisUrl ? false : "AI_RATE_LIMIT_TEST_REDIS_URL is not set" },
	async (context) => {
		const firstClient = createClient({ url: redisUrl });
		const secondClient = createClient({ url: redisUrl });
		await Promise.all([firstClient.connect(), secondClient.connect()]);
		context.after(async () => {
			await Promise.all([firstClient.quit(), secondClient.quit()]);
		});

		const policy = {
			clientWindows: [
				{ name: "minute" as const, limit: 2, windowMs: 2_000 },
			],
			networkWindow: {
				name: "minute" as const,
				limit: 3,
				windowMs: 2_000,
			},
			keyPrefix: `test:ai-rate-limit:${crypto.randomUUID()}`,
		};
		const otherLibraryPolicy = {
			...policy,
			keyPrefix: `${policy.keyPrefix}:other-library`,
		};
		const firstInstance = createRedisAIRateLimitStore(firstClient, policy);
		const secondInstance = createRedisAIRateLimitStore(
			secondClient,
			policy,
		);
		const otherLibraryInstance = createRedisAIRateLimitStore(
			secondClient,
			otherLibraryPolicy,
		);
		const sharedNetwork = "203.0.113.10";
		const firstBrowser = {
			clientId: crypto.randomUUID(),
			clientIp: sharedNetwork,
		};
		const secondBrowser = {
			clientId: crypto.randomUUID(),
			clientIp: sharedNetwork,
		};

		assert.equal((await firstInstance.consume(firstBrowser)).allowed, true);
		assert.equal(
			(await secondInstance.consume(firstBrowser)).allowed,
			true,
		);
		const firstBrowserRejected = await firstInstance.consume(firstBrowser);
		assert.equal(firstBrowserRejected.allowed, false);
		assert.equal(firstBrowserRejected.blockedBy, "client");
		assert.equal(firstBrowserRejected.window, "minute");
		assert.equal(firstBrowserRejected.limit, 2);

		assert.equal(
			(await secondInstance.consume(secondBrowser)).allowed,
			true,
		);
		const networkRejected = await firstInstance.consume(secondBrowser);
		assert.equal(networkRejected.allowed, false);
		assert.equal(networkRejected.blockedBy, "network");
		assert.equal(networkRejected.window, "minute");
		assert.equal(networkRejected.limit, 3);
		assert.equal(
			(await otherLibraryInstance.consume(firstBrowser)).allowed,
			true,
		);

		assert.equal(
			(
				await secondInstance.consume({
					...secondBrowser,
					clientIp: "203.0.113.11",
				})
			).allowed,
			true,
		);

		for (const windowName of ["day", "week", "month"] as const) {
			const windowStore = createRedisAIRateLimitStore(firstClient, {
				clientWindows: [
					{ name: windowName, limit: 1, windowMs: 2_000 },
				],
				networkWindow: {
					name: "minute",
					limit: 100,
					windowMs: 2_000,
				},
				keyPrefix: `${policy.keyPrefix}:${windowName}`,
			});
			const windowBrowser = {
				clientId: crypto.randomUUID(),
				clientIp: `203.0.113.${20 + windowName.length}`,
			};

			assert.equal((await windowStore.consume(windowBrowser)).allowed, true);
			const rejected = await windowStore.consume(windowBrowser);
			assert.equal(rejected.allowed, false);
			assert.equal(rejected.blockedBy, "client");
			assert.equal(rejected.window, windowName);
		}

		await new Promise((resolve) => setTimeout(resolve, 2_050));
		assert.equal((await firstInstance.consume(firstBrowser)).allowed, true);
	},
);

test(
	"translation keeps its own browser budget but shares the network cap with the other AI features",
	{ skip: redisUrl ? false : "AI_RATE_LIMIT_TEST_REDIS_URL is not set" },
	async (context) => {
		const client = createClient({ url: redisUrl });
		await client.connect();
		context.after(() => client.quit());

		const ai = {
			clientWindows: [{ name: "minute" as const, limit: 1, windowMs: 2_000 }],
			networkWindow: { name: "minute" as const, limit: 2, windowMs: 2_000 },
			keyPrefix: `test:ai-rate-limit:${crypto.randomUUID()}`,
		};
		const aiStore = createRedisAIRateLimitStore(client, ai);
		const translationStore = createRedisAIRateLimitStore(client, {
			...ai,
			keyPrefix: `${ai.keyPrefix}:translation`,
			networkKeyPrefix: ai.keyPrefix,
		});
		const browser = { clientId: crypto.randomUUID(), clientIp: "203.0.113.20" };

		assert.equal((await aiStore.consume(browser)).allowed, true);
		// The browser's AI budget is spent, but translation counts its own.
		assert.equal((await translationStore.consume(browser)).allowed, true);
		const third = await translationStore.consume({ ...browser, clientId: crypto.randomUUID() });
		assert.equal(third.allowed, false);
		assert.equal(third.blockedBy, "network");
	},
);
