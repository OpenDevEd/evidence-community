import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		server: { deps: { inline: ["next-intl"] } },
		clearMocks: true,
		environment: "node",
		include: ["tests/unit/**/*.test.{ts,tsx}"],
		restoreMocks: true,
		// The CI guest's 8 vCPUs run these beside the static checks and runtime jobs, where a
		// jsdom render that takes two seconds alone can pass Vitest's default five.
		testTimeout: 15_000,
	},
});
