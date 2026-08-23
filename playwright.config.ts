import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const ciWorkers = Number(process.env.PLAYWRIGHT_WORKERS ?? "1");

if (!baseURL) {
	throw new Error(
		"PLAYWRIGHT_BASE_URL is required. Run npm run test:acceptance to start the disposable test runtime.",
	);
}

if (!Number.isInteger(ciWorkers) || ciWorkers < 1) {
	throw new Error("PLAYWRIGHT_WORKERS must be a positive whole number.");
}

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? ciWorkers : undefined,
	reporter: process.env.CI
		? [
				["list"],
				[
					"junit",
					{
						outputFile:
							process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE ??
							"test-results/playwright.xml",
						stripANSIControlSequences: true,
					},
				],
			]
		: "list",
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
});
