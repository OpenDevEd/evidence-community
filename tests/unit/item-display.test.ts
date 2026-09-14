import { describe, expect, it } from "vitest";
import { ordinaryItemTags, setItemDisplayTag } from "@/lib/item-display";
import { libraryConfigSchema } from "@/config/library-config/schema";

describe("tag-backed item display", () => {
	it("uses the configured primary alias without duplicating an existing alias", () => {
		expect(setItemDisplayTag(["topic"], ["private", "hide"], true)).toEqual(
			["topic", "private"],
		);
		expect(
			setItemDisplayTag(["topic", "HIDE"], ["private", "hide"], true),
		).toEqual(["topic", "HIDE"]);
	});
	it("turns off every matching alias while preserving unrelated tags and other display flags", () => {
		expect(
			setItemDisplayTag(
				["topic", "HIDE", "private", "internal", "_comingsoon"],
				["private", "hide"],
				false,
			),
		).toEqual(["topic", "internal", "_comingsoon"]);
	});
	it("does not invent a persisted tag when the behavior has no configured aliases", () => {
		expect(setItemDisplayTag(["topic"], [], true)).toEqual(["topic"]);
	});
	it("keeps publication and subject tags in the generic editor, excluding only configured display behaviors", () => {
		const config = libraryConfigSchema.shape.content.parse({}).tags;
		expect(
			ordinaryItemTags(
				[
					"topic",
					"_publish",
					"publishPDF",
					"HIDE",
					"internal",
					"_comingsoon",
				],
				config,
			),
		).toEqual(["topic", "_publish", "publishPDF"]);
	});
});
