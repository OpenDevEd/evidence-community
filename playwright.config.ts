import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;

if (!baseURL) {
	throw new Error(
		"PLAYWRIGHT_BASE_URL is required. Run npm run test:e2e to start the disposable test runtime.",
	);
}

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
		{
			name: "webkit-admin",
			testMatch: /admin\.spec\.ts$/u,
			use: { ...devices["Desktop Safari"] },
		},
	],
});
