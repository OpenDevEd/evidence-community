import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
	});
}

test("analytics SDK imports stay behind their gateways", () => {
	const root = join(process.cwd(), "src");
	const violations: string[] = [];

	for (const file of sourceFiles(root)) {
		const path = relative(process.cwd(), file);
		const source = readFileSync(file, "utf8");
		if (
			path !== "src/lib/analytics.ts" &&
			/from\s+["']posthog-js["']/.test(source)
		) {
			violations.push(`${path}: direct posthog-js import`);
		}
		if (
			path !== "src/lib/posthog.ts" &&
			/from\s+["']posthog-node["']/.test(source)
		) {
			violations.push(`${path}: direct posthog-node import`);
		}
		if (
			path !== "src/lib/analytics.ts" &&
			path !== "src/lib/analytics-boundary.test.ts" &&
			source.includes("get_distinct_id(")
		) {
			violations.push(`${path}: direct PostHog distinct ID access`);
		}
	}

	assert.deepEqual(violations, []);
});
