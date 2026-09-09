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
		],
		maxWorkers: 1,
	},
});
