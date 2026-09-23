import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		include: [
			"tools/verifyCrossrefActivation.ts",
			"tools/verifyZenodoActivation.ts",
			"tools/verifyPublicationWorker.ts",
			"tools/verifyPublicationReconciler.ts",
			"tools/verifyNativeFileLifecycle.ts",
            "tests/integration/editorial-reviews.test.ts",
            "tests/integration/country-focus.test.ts",
            "tests/integration/notifications.test.ts",
            "tests/integration/public-library-status.test.ts",
            "tests/integration/public-item-read.test.ts",
            "tests/integration/reviewed-publications.test.ts",
		],
		maxWorkers: 1,
	},
});
