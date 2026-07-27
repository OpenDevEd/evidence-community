export const COLOR_SHADE_FACTORS = {
	50: 0.1,
	100: 0.2,
	200: 0.4,
	300: 0.6,
	400: 0.8,
	500: 1,
	600: 1.15,
	700: 1.3,
	800: 1.45,
	900: 1.6,
} as const;

export type ColorShade = keyof typeof COLOR_SHADE_FACTORS;
export type RgbaColor = readonly [
	red: number,
	green: number,
	blue: number,
	alpha: number,
];
export type ColorRamp = Record<ColorShade, RgbaColor>;

export function parseHexColor(value: string): RgbaColor {
	const red = Number.parseInt(value.slice(1, 3), 16);
	const green = Number.parseInt(value.slice(3, 5), 16);
	const blue = Number.parseInt(value.slice(5, 7), 16);
	const alpha =
		value.length === 9
			? Number.parseInt(value.slice(7, 9), 16) / 255
			: 1;

	return [red, green, blue, alpha];
}

function clampChannel(channel: number) {
	return Math.round(Math.max(0, Math.min(255, channel)));
}

export function generateColorRamp(value: string): ColorRamp {
	const [red, green, blue, alpha] = parseHexColor(value);
	const ramp = {} as ColorRamp;

	for (const [shade, factor] of Object.entries(
		COLOR_SHADE_FACTORS,
	)) {
		ramp[Number(shade) as ColorShade] = [
			clampChannel(red * factor),
			clampChannel(green * factor),
			clampChannel(blue * factor),
			alpha,
		];
	}

	return ramp;
}

export function formatRgbChannels(color: RgbaColor) {
	return `${color[0]} ${color[1]} ${color[2]}`;
}

export function formatCssColor(color: RgbaColor) {
	return `rgb(${formatRgbChannels(color)} / ${color[3]})`;
}
