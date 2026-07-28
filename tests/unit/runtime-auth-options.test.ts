import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Adapter } from "next-auth/adapters";
import type { NextAuthConfig } from "next-auth";

import { buildAuthOptions } from "@/lib/auth-options";
import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

function providerIds(options: NextAuthConfig) {
	return options.providers.map((provider) => {
		if (typeof provider === "function") {
			throw new Error("Unexpected lazy provider");
		}
		return provider.id;
	});
}

const adapter = {
	createSession: vi.fn(),
} as unknown as Adapter;

const dependencies = {
	adapter,
	authorize: vi.fn(),
	getProfile: vi.fn(),
};

describe("runtime Auth.js options", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses the runtime secret and complete enabled provider set", () => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		const options = buildAuthOptions(config, dependencies);

		expect(options.secret).toBe(
			"12345678901234567890123456789012",
		);
		expect(options.adapter).toBe(adapter);
		expect(providerIds(options)).toEqual([
			"google",
			"credentials",
		]);

		const google = options.providers[0];
		expect(google).toMatchObject({
			options: {
				clientId: "google-client-id",
				clientSecret: "google-client-secret-value",
			},
		});
	});

	it("omits Google when runtime Google authentication is disabled", () => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		input.authentication!.google = { enabled: false };
		const config = libraryConfigSchema.parse(input);

		expect(
			providerIds(buildAuthOptions(config, dependencies)),
		).toEqual(["credentials"]);
	});

	it("builds no providers or database adapter when login is disabled", () => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		input.features!.login = false;
		input.features!.userCollections = false;
		input.authentication = {
			google: {
				enabled: false,
			},
		};
		const config = libraryConfigSchema.parse(input);
		const options = buildAuthOptions(config);

		expect(options.providers).toEqual([]);
		expect(options.adapter).toBeUndefined();
		expect(options.secret).toEqual(expect.any(String));
		expect(String(options.secret).length).toBeGreaterThanOrEqual(32);
		expect(options.secret).not.toBe(
			"evidence-library-login-disabled-000000000",
		);
	});

	it("requires dependencies when login is enabled", () => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);

		expect(() => buildAuthOptions(config)).toThrow(
			"Enabled login requires runtime authentication dependencies",
		);
	});

	it("rejects Auth.js URL environment overrides", () => {
		vi.stubEnv("AUTH_URL", "https://stale.example.org");
		const config = libraryConfigSchema.parse(maximalLibraryConfig);

		expect(() =>
			buildAuthOptions(config, dependencies),
		).toThrow(
			"AUTH_URL must be removed; configure the authentication origin with identity.baseUrl",
		);
	});
});
