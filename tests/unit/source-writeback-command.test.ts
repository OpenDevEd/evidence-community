import { describe, expect, it } from "vitest";

import {
	parseSourceWritebackCommand,
	SOURCE_WRITEBACK_USAGE,
} from "@/lib/source-writeback/command";

describe("source writeback command", () => {
	it("uses bounded worker defaults for one sweep", () => {
		expect(parseSourceWritebackCommand([], "host:123")).toEqual({
			maxJobsPerSweep: 10_000,
			pollMs: 60_000,
			watch: false,
			workerId: "host:123",
		});
	});

	it("parses watch, batch, polling, and worker options", () => {
		expect(
			parseSourceWritebackCommand(
				[
					"--watch",
					"--max-jobs",
					"250",
					"--poll-ms",
					"5000",
					"--worker-id",
					" writer-a ",
				],
				"host:123",
			),
		).toEqual({
			maxJobsPerSweep: 250,
			pollMs: 5_000,
			watch: true,
			workerId: "writer-a",
		});
	});

	it.each([
		["unknown option", ["--connection", "zotero-test"]],
		["missing value", ["--max-jobs"]],
		["small batch", ["--max-jobs", "0"]],
		["large batch", ["--max-jobs", "1000001"]],
		["small poll", ["--poll-ms", "999"]],
		["large poll", ["--poll-ms", "3600001"]],
		["invalid number", ["--poll-ms", "soon"]],
		["blank worker", ["--worker-id", " "]],
	])("rejects %s with the documented usage", (_label, args) => {
		expect(() => parseSourceWritebackCommand(args, "host:123")).toThrow(
			SOURCE_WRITEBACK_USAGE,
		);
	});

	it("rejects an invalid default worker id", () => {
		expect(() => parseSourceWritebackCommand([], " ")).toThrow(
			SOURCE_WRITEBACK_USAGE,
		);
	});
});
