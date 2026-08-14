import { describe, expect, it } from "vitest";

import {
	parseSearchIndexCommand,
	SEARCH_INDEX_USAGE,
} from "@/lib/search-index/command";

describe("search index command", () => {
	it("uses bounded defaults for one sweep", () => {
		expect(parseSearchIndexCommand([], "host:123")).toEqual({
			maxEvents: 10_000,
			pollMs: 1_000,
			rebuild: false,
			requeueDeadLetters: false,
			watch: false,
			workerId: "host:123",
		});
	});

	it("parses watch options", () => {
		expect(
			parseSearchIndexCommand(
				[
					"--requeue-dead-letters",
					"--watch",
					"--max-events",
					"250",
					"--poll-ms",
					"5000",
					"--worker-id",
					" worker-a ",
				],
				"host:123",
			),
		).toEqual({
			maxEvents: 250,
			pollMs: 5_000,
			rebuild: false,
			requeueDeadLetters: true,
			watch: true,
			workerId: "worker-a",
		});
	});

	it("rejects the removed optional missing-index mode", () => {
		expect(() =>
			parseSearchIndexCommand(["--rebuild-if-missing"], "host:123"),
		).toThrow(SEARCH_INDEX_USAGE);
	});

	it.each([
		["unknown option", ["--connection", "zotero-test"]],
		["missing value", ["--max-events"]],
		["small batch", ["--max-events", "0"]],
		["large batch", ["--max-events", "1000001"]],
		["small poll", ["--poll-ms", "99"]],
		["large poll", ["--poll-ms", "60001"]],
		["invalid number", ["--poll-ms", "soon"]],
		["blank worker", ["--worker-id", " "]],
	])("rejects %s with the documented usage", (_label, args) => {
		expect(() => parseSearchIndexCommand(args, "host:123")).toThrow(
			SEARCH_INDEX_USAGE,
		);
	});
});
