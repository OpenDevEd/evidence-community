import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fieldSummaryHeadline } from "@/components/admin/AdminInspector";

describe("field summary headline", () => {
	it("tells the editor to fix their own validation mistakes", () => {
		expect(fieldSummaryHeadline(1, "validation")).toBe(
			"Fix 1 field before publishing.",
		);
		expect(fieldSummaryHeadline(3, "validation")).toBe(
			"Fix 3 fields before publishing.",
		);
	});

	it("does not blame the editor for a change made in another session", () => {
		expect(fieldSummaryHeadline(1, "conflict")).toBe(
			"1 field changed in another session. Reload to see the new value.",
		);
		expect(fieldSummaryHeadline(2, "conflict")).toBe(
			"2 fields changed in another session. Reload to see the new values.",
		);
		expect(fieldSummaryHeadline(1, "conflict")).not.toContain("Fix");
	});
});
