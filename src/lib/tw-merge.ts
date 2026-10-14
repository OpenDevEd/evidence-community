import { extendTailwindMerge } from "tailwind-merge";

/** The theme's own font sizes and shadows (tailwind.config.ts `fontSize` and `boxShadow`, and NextUI's sizes); a new one belongs here too. */
const CUSTOM_FONT_SIZES = ["inspector-title", "catalogue-label", "citation", "tiny", "small", "medium", "large"] as const;
const CUSTOM_SHADOWS = [
	"filter-control",
	"filter-control-dark",
	"card-soft",
	"card-flat",
	"card-hairline",
	"card-lifted",
	"composer",
	"composer-focus",
	"composer-focus-dark",
	"accent-glow",
] as const;

/**
 * tailwind-merge that knows the theme's own sizes and shadows. The stock one reads an unknown `text-citation` as a
 * colour, so a later `text-black/55` removed it and the element fell back to the surrounding font size (NextUI's
 * `text-small` too); the same
 * happened to a custom shadow followed by a shadow colour.
 */
export const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			"font-size": [{ text: [...CUSTOM_FONT_SIZES] }],
			shadow: [{ shadow: [...CUSTOM_SHADOWS] }],
		},
	},
});
