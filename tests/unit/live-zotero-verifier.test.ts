import { describe, expect, it, vi } from "vitest";

// The source runtime now reaches the OpenAlex importer, which is server-only.
vi.mock("server-only", () => ({}));

import {
	assertLiveZoteroConnection,
	assertLoopbackServiceUrl,
	LIVE_ZOTERO_CONNECTION_KEY,
	parseLiveVerifierCommand,
} from "../../tools/verifyLiveZoteroPipeline";

describe("live Zotero verifier guards", () => {
	it("requires both explicit confirmations", () => {
		expect(
			parseLiveVerifierCommand([
				"--confirm-group",
				"6632364",
				"--confirm-local-writes",
			]),
		).toEqual({
			confirmGroup: "6632364",
			confirmLocalWrites: true,
		});
		expect(() => parseLiveVerifierCommand([])).toThrow(/Usage/u);
		expect(() =>
			parseLiveVerifierCommand([
				"--confirm-group",
				"wrong",
				"--confirm-local-writes",
			]),
		).toThrow(/Usage/u);
		expect(() =>
			parseLiveVerifierCommand(["--confirm-group", "6632364"]),
		).toThrow(/Usage/u);
	});

	it("accepts only loopback service URLs", () => {
		expect(
			assertLoopbackServiceUrl(
				"Database URL",
				"postgresql://library:library@127.0.0.1:55435/library",
			).hostname,
		).toBe("127.0.0.1");
		expect(
			assertLoopbackServiceUrl("Search URL", "http://localhost:7700")
				.hostname,
		).toBe("localhost");
		expect(() =>
			assertLoopbackServiceUrl(
				"Database URL",
				"postgresql://library:library@database.internal/library",
			),
		).toThrow(/must use localhost/u);
	});

	it("checks the actual connection provider, scope, group, and status", () => {
		const valid = {
			externalScopeKey: "6632364",
			key: LIVE_ZOTERO_CONNECTION_KEY,
			provider: "zotero",
			scopeKind: "group",
			status: "active",
		};
		expect(() => assertLiveZoteroConnection(valid)).not.toThrow();
		expect(() =>
			assertLiveZoteroConnection({
				...valid,
				externalScopeKey: "9999999",
			}),
		).toThrow(/must be the Zotero group/u);
		expect(() =>
			assertLiveZoteroConnection({ ...valid, status: "paused" }),
		).toThrow(/must be active/u);
	});
});
