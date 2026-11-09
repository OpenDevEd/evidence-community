import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	buildThemeColorCss,
	buildThemeFontCss,
	LibraryThemeStyles,
	themeGoogleFonts,
} from "@/components/library/LibraryThemeStyles";
import {
	createLibraryConfigSchema,
	libraryConfigSchema,
	type LibraryConfigInput,
} from "@/config/library-config/schema";
import {
	formatCssColor,
	generateColorRamp,
	parseHexColor,
} from "@/config/library-config/theme";
import {
	maximalLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

const minimalTheme = libraryConfigSchema.parse(
	minimalLibraryConfig,
).theme;
const maximalTheme = libraryConfigSchema.parse(
	maximalLibraryConfig,
).theme;

describe("runtime theme tokens", () => {
	it("generates every required shade and preserves configured alpha", () => {
		const ramp = generateColorRamp("#33669980");

		expect(Object.keys(ramp)).toEqual([
			"50",
			"100",
			"200",
			"300",
			"400",
			"500",
			"600",
			"700",
			"800",
			"900",
		]);
		expect(ramp[500]).toEqual([
			51,
			102,
			153,
			128 / 255,
		]);
		expect(ramp[600]).toEqual([
			59,
			117,
			176,
			128 / 255,
		]);
		expect(formatCssColor(ramp[500])).toBe(
			`rgb(51 102 153 / ${128 / 255})`,
		);
		expect(parseHexColor("#FFFFFF")).toEqual([255, 255, 255, 1]);
	});

	it("emits runtime variables for every configurable semantic color", () => {
		const css = buildThemeColorCss(maximalTheme);

		for (const token of [
			"accent",
			"link",
			"collection",
			"doi",
			"tertiary",
			"background",
			"background_light",
			"card",
			"card_light",
			"secondary",
			"secondary_light",
		]) {
			expect(css).toContain(`--color-${token}-50:`);
			expect(css).toContain(`--color-${token}-500:`);
			expect(css).toContain(`--color-${token}-900:`);
			expect(css).toContain(`--color-${token}-500-alpha:`);
		}

		expect(css).toContain("--color-accent-500:230 129 36");
		expect(css).toContain("--color-link-500:25 118 210");
		expect(css).toContain("--color-background-500:15 15 15");
		expect(css).toContain(
			"--color-background_light-500:244 242 238",
		);
		expect(css).toContain("--color-card-500:20 20 20");
		expect(css).toContain("--color-card_light-500:255 255 255");
		// Panels follow the backgrounds; the platform's own backgrounds keep the panels every community has today.
		expect(css).toContain("--color-secondary-500:30 30 30");
		expect(css).toContain("--color-secondary_light-500:232 230 226");
		expect(css).toContain(
			":root.light,:root.dark{--nextui-focus:",
		);
	});

	it("keeps one set of colours for both modes when the theme gives no dark ones", () => {
		const css = buildThemeColorCss(maximalTheme);

		expect(css).not.toContain(":root.dark{--color");
		expect(css).toContain(":root.light,:root.dark{--nextui-focus:");
	});

	it("switches dark mode to the dark accent, and the colours that follow it", () => {
		const css = buildThemeColorCss(
			libraryConfigSchema.parse({
				...minimalLibraryConfig,
				theme: { colors: { ...minimalLibraryConfig.theme.colors, accentDark: "#5B8DEF" } },
			}).theme,
		);
		const [light, dark] = css.split(":root.dark{--color");

		expect(light).toContain("--color-accent-500:230 129 36");
		for (const token of ["accent", "link", "collection", "doi"]) {
			expect(dark).toContain(`--color-${token}-500:91 141 239`);
		}
		expect(dark).not.toContain("--color-tertiary-");
		expect(css).toContain(":root.light{--nextui-focus:");
	});

	it("reads a dark link of its own against the dark background", () => {
		const result = libraryConfigSchema.safeParse({
			...minimalLibraryConfig,
			theme: { colors: { ...minimalLibraryConfig.theme.colors, backgroundDark: "#000000", linkDark: "#000000" } },
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["theme.colors.linkDark"]);
	});

	it("tints the panels with a community's own backgrounds", () => {
		const css = buildThemeColorCss({
			...maximalTheme,
			colors: { ...maximalTheme.colors, backgroundDark: "#1C1B24", backgroundLight: "#F7F7FA" },
		});

		expect(css).toContain("--color-secondary-500:42 41 50");
		expect(css).toContain("--color-secondary_light-500:235 235 238");
	});
});

describe("runtime theme assets", () => {
	it("renders the small light fixture with its supported Google font", () => {
		expect(minimalTheme.layout).toBe("small");
		expect(minimalTheme.defaultMode).toBe("light");
		expect(minimalTheme.forcedMode).toBeNull();
		expect(minimalTheme.fonts.heading).toEqual({
			source: "google",
			family: "Ubuntu",
		});
		expect(themeGoogleFonts(minimalTheme)).toEqual(["Ubuntu"]);

		const markup = renderToStaticMarkup(
			<LibraryThemeStyles theme={minimalTheme} />,
		);

		expect(markup).toContain('data-library-theme="true"');
		// next/font serves the font from the library itself: nothing is asked of Google.
		expect(markup).not.toContain("fonts.googleapis.com");
		expect(markup).toContain("--font-body:var(--font-ubuntu),sans-serif");
	});

	it("renders the wide system fixture with Google and WOFF2 fonts", () => {
		expect(maximalTheme.layout).toBe("wide");
		expect(maximalTheme.defaultMode).toBe("system");
		expect(maximalTheme.forcedMode).toBeNull();
		expect(themeGoogleFonts(maximalTheme)).toEqual(["Montserrat"]);

		const fontCss = buildThemeFontCss(maximalTheme);
		expect(fontCss).toContain(
			'font-family:"Maximal Sans";src:url("https://assets.example.org/fonts/maximal-sans.woff2") format("woff2")',
		);
		expect(fontCss).toContain("font-weight:100 900");
		expect(fontCss).toContain(
			"--font-heading:var(--font-montserrat),sans-serif",
		);
		expect(fontCss).toContain(
			'--font-body:"Maximal Sans",sans-serif',
		);
	});

	it("loads Poppins from the runtime config", () => {
		const input = structuredClone(
			maximalLibraryConfig,
		) as LibraryConfigInput;
		input.theme.fonts!.heading = { source: "google", family: "Poppins" };
		input.theme.fonts!.body = { source: "google", family: "Poppins" };
		const theme = libraryConfigSchema.parse(input).theme;

		expect(themeGoogleFonts(theme)).toEqual(["Poppins"]);
		expect(buildThemeFontCss(theme)).toContain(
			"--font-heading:var(--font-poppins),sans-serif;--font-body:var(--font-poppins),sans-serif",
		);
	});

	it.each(["light", "dark"] as const)(
		"accepts a forced %s mode only when the switcher is excluded",
		(forcedMode) => {
			const input = structuredClone(
				maximalLibraryConfig,
			) as LibraryConfigInput;
			input.theme.defaultMode = forcedMode;
			input.theme.forcedMode = forcedMode;
			input.features!.themeSwitcher = false;

			const result = createLibraryConfigSchema({
				collectionIds: ["collection-one", "collection-two"],
				institutionNames: [
					"Institution One",
					"Indexed Institution Without Branding",
				],
			}).safeParse(input);

			expect(result.success).toBe(true);

			input.features!.themeSwitcher = true;
			const invalidResult = libraryConfigSchema.safeParse(input);
			expect(invalidResult.success).toBe(false);
			expect(
				invalidResult.error?.issues.some(
					(issue) =>
						issue.path.join(".") ===
							"features.themeSwitcher" &&
						issue.message.includes("must be disabled"),
				),
			).toBe(true);
		},
	);

	it("rejects uploaded font family values that could escape CSS", () => {
		const input = structuredClone(
			maximalLibraryConfig,
		) as LibraryConfigInput;
		input.theme.fonts!.body = {
			source: "woff2",
			family: 'Unsafe";color:red',
			url: "https://assets.example.org/fonts/unsafe.woff2",
			weight: "variable",
		};

		const result = libraryConfigSchema.safeParse(input);

		expect(result.success).toBe(false);
		expect(
			result.error?.issues.some(
				(issue) =>
					issue.path.join(".") ===
						"theme.fonts.body.family" &&
					issue.message.includes("Font family"),
			),
		).toBe(true);
	});

	it("rejects raw HTML delimiters in uploaded font URLs", () => {
		const input = structuredClone(
			maximalLibraryConfig,
		) as LibraryConfigInput;
		input.theme.fonts!.body = {
			source: "woff2",
			family: "Unsafe URL",
			url: "https://assets.example.org/fonts/</style><script>alert(1)</script>/unsafe.woff2",
			weight: "variable",
		};

		const result = libraryConfigSchema.safeParse(input);

		expect(result.success).toBe(false);
		expect(
			result.error?.issues.some(
				(issue) =>
					issue.path.join(".") === "theme.fonts.body.url" &&
					issue.message.includes("HTML delimiter"),
			),
		).toBe(true);
	});

	it("rejects conflicting sources for the same font family", () => {
		const input = structuredClone(
			maximalLibraryConfig,
		) as LibraryConfigInput;
		input.theme.fonts!.heading = {
			source: "woff2",
			family: "Brand Sans",
			url: "https://assets.example.org/fonts/brand-heading.woff2",
			weight: "variable",
		};
		input.theme.fonts!.body = {
			source: "woff2",
			family: "brand sans",
			url: "https://assets.example.org/fonts/brand-body.woff2",
			weight: "variable",
		};

		const result = libraryConfigSchema.safeParse(input);

		expect(result.success).toBe(false);
		expect(
			result.error?.issues.some(
				(issue) =>
					issue.path.join(".") ===
						"theme.fonts.body.family" &&
					issue.message.includes("same source"),
			),
		).toBe(true);
	});

	it("emits one face for a static WOFF2 font", () => {
		const input = structuredClone(
			maximalLibraryConfig,
		) as LibraryConfigInput;
		input.theme.fonts!.body = {
			source: "woff2",
			family: "Static Sans",
			url: "https://assets.example.org/fonts/static-sans.woff2",
			weight: 400,
		};
		input.theme.fonts!.weights = [400];
		const theme = libraryConfigSchema.parse(input).theme;

		const fontCss = buildThemeFontCss(theme);

		expect(fontCss).toContain("font-weight:400");
		expect(fontCss).not.toContain("font-weight:100 900");
	});
});
