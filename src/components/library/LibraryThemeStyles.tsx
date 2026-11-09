import type { LibraryPublicConfig } from "@/config/library-config/schema";
import {
	formatRgbChannels,
	generateColorRamp,
	panelColors,
	type RgbaColor,
} from "@/config/library-config/theme";

type Theme = LibraryPublicConfig["theme"];
type ThemeFont = Theme["fonts"]["heading"];

function formatAlpha(alpha: number) {
	return Number(alpha.toFixed(4)).toString();
}

function hslChannels([red, green, blue]: RgbaColor) {
	const r = red / 255;
	const g = green / 255;
	const b = blue / 255;
	const maximum = Math.max(r, g, b);
	const minimum = Math.min(r, g, b);
	const delta = maximum - minimum;
	const lightness = (maximum + minimum) / 2;
	let hue = 0;
	let saturation = 0;

	if (delta !== 0) {
		saturation =
			delta / (1 - Math.abs(2 * lightness - 1));
		if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
		if (maximum === g) hue = 60 * ((b - r) / delta + 2);
		if (maximum === b) hue = 60 * ((r - g) / delta + 4);
	}

	if (hue < 0) hue += 360;
	return `${hue.toFixed(2)} ${(
		saturation * 100
	).toFixed(2)}% ${(lightness * 100).toFixed(2)}%`;
}

export function buildThemeColorCss(theme: Theme) {
	const panels = panelColors(theme.colors);
	const colors = {
		accent: theme.colors.accent,
		link: theme.colors.link,
		collection: theme.colors.collection,
		doi: theme.colors.doi,
		tertiary: theme.colors.tertiary,
		background: theme.colors.backgroundDark,
		background_light: theme.colors.backgroundLight,
		card: theme.colors.cardDark,
		card_light: theme.colors.cardLight,
		secondary: panels.dark,
		secondary_light: panels.light,
	};
	const declarations: string[] = [];

	for (const [name, value] of Object.entries(colors)) {
		const ramp = generateColorRamp(value);
		for (const [shade, color] of Object.entries(ramp)) {
			declarations.push(
				`--color-${name}-${shade}:${formatRgbChannels(color)}`,
				`--color-${name}-${shade}-alpha:${formatAlpha(color[3])}`,
			);
		}
	}

	const nextUiFocus = hslChannels(
		generateColorRamp(theme.colors.accent)[500],
	);

	return `:root{${declarations.join(";")}}:root.light,:root.dark{--nextui-focus:${nextUiFocus}}`;
}

/** The Google fonts a theme uses, each once. */
export function themeGoogleFonts(theme: Theme) {
	const families = [theme.fonts.heading, theme.fonts.body].flatMap((font) => (font.source === "google" ? [font.family] : []));
	return [...new Set(families)];
}

/**
 * A theme font's family list. A Google font is self-hosted by next/font, which
 * sets `--font-montserrat`, `--font-poppins` or `--font-ubuntu` (platform-fonts.ts)
 * to the font and its size-adjusted fallback.
 */
function fontStack(font: ThemeFont) {
	const family = font.source === "google" ? `var(--font-${font.family.toLowerCase()})` : JSON.stringify(font.family);
	return `${family},sans-serif`;
}

function fontFaceCss(
	font: Extract<ThemeFont, { source: "woff2" }>,
) {
	const fontFamily = JSON.stringify(font.family);
	const source = `url(${JSON.stringify(font.url)}) format("woff2")`;

	if (font.weight === "variable") {
		return `@font-face{font-family:${fontFamily};src:${source};font-style:normal;font-weight:100 900;font-display:swap}`;
	}

	return `@font-face{font-family:${fontFamily};src:${source};font-style:normal;font-weight:${font.weight};font-display:swap}`;
}

export function buildThemeFontCss(theme: Theme) {
	const uploadedFonts = [
		theme.fonts.heading,
		theme.fonts.body,
	].filter(
		(font): font is Extract<ThemeFont, { source: "woff2" }> =>
			font.source === "woff2",
	);
	const faces = Array.from(
		new Map(
			uploadedFonts.map((font) => [
				`${font.family}:${font.url}`,
				font,
			]),
		).values(),
	)
		.map((font) => fontFaceCss(font))
		.join("");

	return `${faces}:root{--font-heading:${fontStack(theme.fonts.heading)};--font-body:${fontStack(theme.fonts.body)}}`;
}

export function LibraryThemeStyles({ theme }: { theme: Theme }) {
	const css = `${buildThemeColorCss(theme)}${buildThemeFontCss(theme)}`;

	return <style data-library-theme dangerouslySetInnerHTML={{ __html: css }} />;
}
