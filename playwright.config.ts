import { defineConfig, devices } from "@playwright/test";

const baseURL =
	process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "list",
	use: {
		baseURL,
		ignoreHTTPSErrors:
			process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === "true",
		screenshot: "only-on-failure",
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			testIgnore: /runtime-mobile\.spec\.ts$/u,
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "mobile-chromium",
			testMatch: /runtime-mobile\.spec\.ts$/u,
			use: { ...devices["Pixel 5"] },
		},
	],
	webServer: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: {
				command:
					"LIBRARY_CONFIG_PATH=config/library.example.json npm run dev -- --hostname 127.0.0.1 --port 3100",
				reuseExistingServer: false,
				timeout: 120_000,
				url: `${baseURL}/api/library-config/health`,
			},
});
