import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const unitTests = ["tests/unit/**/*.test.{ts,tsx}"];

/** Whether a test file replaces a module with vi.mock, itself or through a local file it imports. */
function mocksModules(file: string, seen = new Set<string>()): boolean {
	if (seen.has(file)) return false;
	seen.add(file);
	const source = readFileSync(file, "utf8");
	if (/\bvi\.(mock|doMock)\(/.test(source)) return true;
	return [...source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].some(([, specifier]) => {
		const base = path.join(path.dirname(file), specifier);
		const local = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
		return local !== undefined && mocksModules(local, seen);
	});
}

// Isolated files run in the VM contexts of vmThreads: cheaper than a fresh worker per file.
// These need a real worker and run in forks: code that loads html-react-parser, whose CommonJS
// build requires an ES module, which a VM context can't, and error handling that checks
// `instanceof` against errors made in another realm.
const workerTests = [
	"tests/unit/admin-digests.test.tsx",
	"tests/unit/admin-http.test.ts",
	"tests/unit/ai-chat-window.test.tsx",
	"tests/unit/ai-inline-chat.test.tsx",
	"tests/unit/citation-text.test.tsx",
	"tests/unit/filter-chips.test.tsx",
	"tests/unit/item-details-card.test.tsx",
	"tests/unit/item-sharing-metadata.test.ts",
	"tests/unit/openscholar-configuration-route.test.ts",
	"tests/unit/runtime-export-route.test.ts",
	"tests/unit/runtime-item-export-route.test.ts",
];

const files = globSync(unitTests).filter((file) => !workerTests.includes(file));
const domTests = files.filter((file) => readFileSync(file, "utf8").includes("@vitest-environment jsdom"));
const mockingTests = files.filter((file) => !domTests.includes(file) && mocksModules(file));

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		// @react-aria/i18n 3.13.1 ships ES module files in its CommonJS build, so the packages that use it are read
		// through their ES module builds here, as the application's own bundler reads them.
		server: { deps: { inline: ["next-intl", /node_modules\/@(react-aria|react-stately|nextui-org)\//] } },
		clearMocks: true,
		restoreMocks: true,
		// The CI guest's 8 vCPUs run these beside the static checks and runtime jobs, where a
		// jsdom render that takes two seconds alone can pass Vitest's default five.
		testTimeout: 15_000,
		projects: [
			// Files share one module graph per worker, which saves importing every module again for
			// each file: most of the suite's CPU. A file that mocks a module, or needs jsdom, keeps
			// its own module graph instead, since another file may have loaded the real module.
			{ extends: true, test: { name: "unit", environment: "node", include: unitTests, exclude: [...domTests, ...mockingTests, ...workerTests], isolate: false, setupFiles: ["./tests/shared-worker.ts"] } },
			{ extends: true, test: { name: "unit-mocks", environment: "node", include: mockingTests, pool: "vmThreads" } },
			{ extends: true, test: { name: "dom", environment: "jsdom", include: domTests, pool: "vmThreads", setupFiles: ["./tests/dom-globals.ts"] } },
			{ extends: true, test: { name: "workers", environment: "node", include: workerTests, setupFiles: ["./tests/dom-globals.ts"] } },
		],
	},
});
