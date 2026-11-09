import { formatCssColor, generateColorRamp, parseHexColor, type RgbaColor } from "@/config/library-config/theme";
import type { Tone, Tones } from "./HomePage";

// The home page's band colours, worked out from the library's theme, where the page and its placeholder both read them.

/** Screen luminance as APCA estimates it, with its soft clamp near black. */
function apcaLuminance([red, green, blue]: RgbaColor) {
	const y = 0.2126729 * (red / 255) ** 2.4 + 0.7151522 * (green / 255) ** 2.4 + 0.072175 * (blue / 255) ** 2.4;
	return y < 0.022 ? y + (0.022 - y) ** 1.414 : y;
}

/**
 * Perceived lightness contrast of text on a background (APCA 0.0.98G), as an absolute Lc.
 * The WCAG 2 ratio overrates dark text on saturated mid-tones, which put black on the accent.
 */
function apcaContrast(text: RgbaColor, background: RgbaColor) {
	const yText = apcaLuminance(text);
	const yBackground = apcaLuminance(background);
	const lc = yBackground > yText ? (yBackground ** 0.56 - yText ** 0.57) * 1.14 : (yBackground ** 0.65 - yText ** 0.62) * 1.14;
	return Math.abs(lc) < 0.1 ? 0 : Math.abs(lc) - 0.027;
}

/** WCAG 2 contrast ratio, the measure the AAA target is written in. */
function wcagRatio(first: RgbaColor, second: RgbaColor) {
	const luminance = (color: RgbaColor) => {
		const channel = (value: number) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
		return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
	};
	const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
	return (lighter! + 0.05) / (darker! + 0.05);
}

/** Text colour that reads on a given background: the configured dark or light neutral, whichever is perceived as contrasting more. */
function readableOn(background: RgbaColor, dark: RgbaColor, light: RgbaColor) {
	return apcaContrast(dark, background) > apcaContrast(light, background) ? dark : light;
}

function mix(color: RgbaColor, surface: RgbaColor, amount: number): RgbaColor {
	const channel = (index: 0 | 1 | 2) => Math.round(color[index] * amount + surface[index] * (1 - amount));
	return [channel(0), channel(1), channel(2), 1];
}

const RAMP_STEPS = 8;

/** Band tones plus a sequential ramp of the accent over the card surface the charts sit on, every step with its own readable text colour in both modes. */
export function tonesFrom(colors: { accent: string; accentDark: string; tertiary: string; tertiaryDark: string; backgroundLight: string; backgroundDark: string; cardLight: string; cardDark: string }): { tones: Tones; ramp: Tone[] } {
	const dark = parseHexColor(colors.backgroundDark);
	const light = parseHexColor(colors.cardLight);
	const accent = parseHexColor(colors.accent);
	const accentDark = parseHexColor(colors.accentDark);
	const tint = mix(accent, parseHexColor(colors.backgroundLight), 0.1);
	const tintDark = mix(accentDark, dark, 0.12);
	const channels = ([red, green, blue]: RgbaColor) => `${red} ${green} ${blue}`;
	const tone = (bg: RgbaColor, bgDark: RgbaColor): Tone => {
		const fg = readableOn(bg, dark, light);
		const fgDark = readableOn(bgDark, dark, light);
		return { bg: formatCssColor(bg), fg: formatCssColor(fg), fgRgb: channels(fg), bgDark: formatCssColor(bgDark), fgDark: formatCssColor(fgDark), fgRgbDark: channels(fgDark) };
	};
	const tertiary = generateColorRamp(colors.tertiary);
	const tertiaryDark = generateColorRamp(colors.tertiaryDark);
	// The accent at the lightest shade whose text meets WCAG AAA (7:1), for a band set entirely in the accent.
	const deepOf = (color: string) => {
		const accentRamp = generateColorRamp(color);
		return ([400, 300, 200, 100, 50] as const).map((shade) => accentRamp[shade]).find((shade) => wcagRatio(readableOn(shade, dark, light), shade) >= 7) ?? accentRamp[50];
	};
	return {
		tones: {
			page: tone(parseHexColor(colors.backgroundLight), parseHexColor(colors.backgroundDark)),
			card: tone(parseHexColor(colors.cardLight), parseHexColor(colors.cardDark)),
			tint: tone(tint, tintDark),
			accent: tone(accent, accentDark),
			tertiary: tone(tertiary[500], tertiaryDark[600]),
			deep: tone(deepOf(colors.accent), deepOf(colors.accentDark)),
		},
		ramp: Array.from({ length: RAMP_STEPS }, (_, index) => {
			const amount = 1 - (0.84 * index) / (RAMP_STEPS - 1);
			return tone(mix(accent, light, amount), mix(accentDark, parseHexColor(colors.cardDark), amount));
		}),
	};
}
