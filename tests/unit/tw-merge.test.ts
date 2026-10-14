import { describe, expect, it } from "vitest";

import { twMerge } from "@/lib/tw-merge";

describe("twMerge", () => {
	// The stock merge reads an unknown size as a colour, so the colour after it removed the size.
	it("keeps the theme's and NextUI's font sizes when a text colour follows", () => {
		for (const size of ["text-citation", "text-small", "text-tiny"]) expect(twMerge(size, "text-black/70")).toBe(`${size} text-black/70`);
	});

	it("still lets a later size replace an earlier one", () => {
		expect(twMerge("text-small", "text-tiny")).toBe("text-tiny");
	});
});
