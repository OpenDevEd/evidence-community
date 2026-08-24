import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
	getDatabaseForConfig: vi.fn(),
}));

vi.mock("@/db", () => ({
	getDatabaseForConfig: harness.getDatabaseForConfig,
}));

import { libraryConfigSchema } from "@/config/library-config/schema";
import { authorizeForConfig } from "@/lib/auth-service";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

describe("runtime authentication service", () => {
	beforeEach(() => {
		harness.getDatabaseForConfig.mockReset();
	});

	it("rejects credentials before opening a database when login is disabled", async () => {
		const input = cloneLibraryConfig(maximalLibraryConfig);
		input.features!.login = false;
		input.features!.userCollections = false;
		input.authentication = {
			...input.authentication!,
			google: {
				enabled: false,
			},
		};
		const config = libraryConfigSchema.parse(input);

		await expect(
			authorizeForConfig(
				{
					email: "reader@example.org",
					password: "password123",
				},
				config,
			),
		).resolves.toEqual({ error: "loginDisabled" });
		expect(harness.getDatabaseForConfig).not.toHaveBeenCalled();
	});
});
