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
			"tests/integration/library-export-selection.test.ts",
			"tests/integration/topic-review.test.ts",
            "tests/integration/item-preview.test.ts",
			"tests/integration/topics-lifecycle.test.ts",
			"tests/integration/openalex-refresh.test.ts",
			"tests/integration/openalex-source.test.ts",
			"tests/integration/open-access.test.ts",
			"tests/integration/search-requeue.test.ts",
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
            "tests/integration/digest-editorial.test.ts",
            "tests/integration/digest-kinds.test.ts",
            "tests/integration/record-reading.test.ts",
            "tests/integration/public-library-status.test.ts",
            "tests/integration/reader-collection-privacy.test.ts",
            "tests/integration/reader-accounts.test.ts",
            "tests/integration/public-item-read.test.ts",
            "tests/integration/reviewed-publications.test.ts",
            "tests/integration/zotero-citations.test.ts",
            "tests/integration/source-issues.test.ts",
            "tests/integration/search-outbox-lock-order.test.ts",
            "tests/integration/reread-pdf-text.test.ts",
            "tests/integration/source-restart.test.ts",
		],
		maxWorkers: 1,
		// These run beside the runtime acceptance stack on the CI guest's 8 vCPUs, where a
		// database round trip that takes a second alone can pass Vitest's default five.
		testTimeout: 15_000,
	},
});
