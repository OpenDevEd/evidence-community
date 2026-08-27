import { describe, expect, it } from "vitest";

import { screeningSelection } from "@/lib/ai/screening-selection";

describe("smart screening selection", () => {
	it("reports when cited publications exceed one screening batch", () => {
		const content = Array.from(
			{ length: 30 },
			(_, index) => `https://example.test/lib/ITEM${index}`,
		).join("\n");

		expect(screeningSelection(content)).toEqual({
			keys: Array.from({ length: 25 }, (_, index) => `ITEM${index}`),
			total: 30,
			omitted: 5,
		});
	});

	it("counts the same publication only once", () => {
		const content = [
			"https://example.test/lib/ONE",
			"https://example.test/lib/ONE",
			"https://example.test/lib/TWO",
		].join("\n");

		expect(screeningSelection(content)).toEqual({
			keys: ["ONE", "TWO"],
			total: 2,
			omitted: 0,
		});
	});
});
