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
			"tests/integration/topic-review.test.ts",
            "tests/integration/item-preview.test.ts",
			"tests/integration/topics-lifecycle.test.ts",
			"tests/integration/openalex-refresh.test.ts",
			"tests/integration/openalex-source.test.ts",
			"tests/integration/openscholar-source.test.ts",
			"tests/integration/openalex-attachment-processor.test.ts",
			"tools/verifyCrossrefActivation.ts",
			"tools/verifyZenodoActivation.ts",
			"tools/verifyPublicationWorker.ts",
			"tools/verifyPublicationReconciler.ts",
			"tools/verifyNativeFileLifecycle.ts",
            "tests/integration/editorial-reviews.test.ts",
            "tests/integration/item-cache-version.test.ts",
            "tests/integration/country-focus.test.ts",
            "tests/integration/notifications.test.ts",
            "tests/integration/public-library-status.test.ts",
            "tests/integration/public-item-read.test.ts",
            "tests/integration/reviewed-publications.test.ts",
            "tests/integration/zotero-citations.test.ts",
            "tests/integration/source-issues.test.ts",
		],
		maxWorkers: 1,
	},
});
