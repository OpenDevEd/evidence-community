import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config";
import { CUSTOM_FONT_SIZES, CUSTOM_SHADOWS, twMerge } from "@/lib/tw-merge";

describe("twMerge", () => {
	it("keeps the theme's own font sizes and shadows next to colours", () => {
		expect(twMerge("text-citation font-medium text-black/55")).toBe("text-citation font-medium text-black/55");
		expect(twMerge("shadow-card-soft shadow-black/5")).toBe("shadow-card-soft shadow-black/5");
	});

	it("still lets a later size or shadow replace an earlier one", () => {
		expect(twMerge("text-citation text-sm")).toBe("text-sm");
		expect(twMerge("shadow-card-lifted shadow-sm")).toBe("shadow-sm");
	});

	it("knows every custom size and shadow the Tailwind config defines", () => {
		const extend = (tailwindConfig as { theme: { extend: Record<string, Record<string, unknown>> } }).theme.extend;
		expect([...CUSTOM_FONT_SIZES].sort()).toEqual(Object.keys(extend.fontSize ?? {}).sort());
		expect([...CUSTOM_SHADOWS].sort()).toEqual(Object.keys(extend.boxShadow ?? {}).sort());
	});
});
