import { describe, expect, it } from "vitest";

import {
	summarizeWritebackStates,
	writebackSummaryLabel,
} from "@/components/admin/writeback-summary";

describe("writeback summary", () => {
	it("shows the state that needs attention first", () => {
		expect(summarizeWritebackStates(["synced", "conflict", "failed"])).toBe(
			"conflict",
		);
		expect(summarizeWritebackStates(["synced", "failed", "queued"])).toBe(
			"failed",
		);
		expect(summarizeWritebackStates(["synced", "queued"])).toBe("queued");
		expect(summarizeWritebackStates(["synced", "synced"])).toBe("synced");
		expect(summarizeWritebackStates(["synced", null])).toBe("idle");
		expect(summarizeWritebackStates([])).toBe("idle");
	});

	it("labels the chip in plain words", () => {
		expect(writebackSummaryLabel("synced", 3)).toBe("Synced to 3 sources");
		expect(writebackSummaryLabel("synced", 1)).toBe("Synced to 1 source");
		expect(writebackSummaryLabel("conflict", 2)).toBe("Needs a decision");
		expect(writebackSummaryLabel("sending", 2)).toBe("Syncing");
		expect(writebackSummaryLabel("idle", 2)).toBe("2 sources");
	});
});
