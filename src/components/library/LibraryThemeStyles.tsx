import type { LibraryPublicConfig } from "@/config/library-config/schema";
import {
	formatRgbChannels,
	generateColorRamp,
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

function googleFontFamilyQuery(
	font: Extract<ThemeFont, { source: "google" }>,
	weights: Theme["fonts"]["weights"],
) {
	const sortedWeights = [...weights].sort((a, b) => a - b);
	return `family=${encodeURIComponent(font.family).replace(/%20/g, "+")}:wght@${sortedWeights.join(";")}`;
}

export function buildGoogleFontsUrl(theme: Theme) {
	const googleFonts = [
		theme.fonts.heading,
		theme.fonts.body,
	].filter(
		(font): font is Extract<ThemeFont, { source: "google" }> =>
			font.source === "google",
	);
	const uniqueFamilies = Array.from(
		new Map(googleFonts.map((font) => [font.family, font])).values(),
	);

	if (!uniqueFamilies.length) return null;

	const families = uniqueFamilies
		.map((font) =>
			googleFontFamilyQuery(font, theme.fonts.weights),
		)
		.join("&");
	return `https://fonts.googleapis.com/css2?${families}&display=swap`;
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

	return `${faces}:root{--font-heading:${JSON.stringify(theme.fonts.heading.family)},sans-serif;--font-body:${JSON.stringify(theme.fonts.body.family)},sans-serif}`;
}

export function LibraryThemeStyles({ theme }: { theme: Theme }) {
	const googleFontsUrl = buildGoogleFontsUrl(theme);
	const css = `${buildThemeColorCss(theme)}${buildThemeFontCss(theme)}`;

	return (
		<>
			{googleFontsUrl ? (
				<>
					<link rel="preconnect" href="https://fonts.googleapis.com" />
					<link
						rel="preconnect"
						href="https://fonts.gstatic.com"
						crossOrigin="anonymous"
					/>
					<link rel="stylesheet" href={googleFontsUrl} />
				</>
			) : null}
			<style
				data-library-theme
				dangerouslySetInnerHTML={{ __html: css }}
			/>
		</>
	);
}
