import type { Theme, Verdict } from "./data";

export type RGBA = [number, number, number, number];

/** OKLCH to sRGB, each channel 0 to 1: regions get even steps of lightness and chroma, so no hue shouts over another. */
function oklch(l: number, c: number, h: number, alpha = 1): RGBA {
	const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const linear = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
	];
	const gamma = (v: number) => Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
	return [gamma(linear[0]), gamma(linear[1]), gamma(linear[2]), alpha];
}

/** A colour from its hex code, each channel 0 to 1. */
const hex = (code: string, alpha = 1): RGBA => [1, 3, 5].map((at) => parseInt(code.slice(at, at + 2), 16) / 255).concat(alpha) as RGBA;

/**
 * Each verdict's colours, keeping what Björn's graph means by them (red broken, yellow questionable, orange repairable, light
 * green validated with caveats, green validated, grey for the rest) in one family of tints: a mid-tone for a point on the map
 * and the meter, and for a badge a soft tint, a deep shade of the same colour for its text and icon, and a ring between the
 * two, each for both themes.
 */
type Tone = { dot: string; soft: string; ink: string; ring: string; darkSoft: string; darkInk: string; darkRing: string };
export const VERDICT_TONE: Record<Verdict, Tone> = {
	notAssessed: { dot: "#ffffff", soft: "#f8fafc", ink: "#64748b", ring: "#e2e8f0", darkSoft: "#94a3b81f", darkInk: "#cbd5e1", darkRing: "#94a3b840" },
	pending: { dot: "#cbd5e1", soft: "#f8fafc", ink: "#475569", ring: "#e2e8f0", darkSoft: "#94a3b81f", darkInk: "#cbd5e1", darkRing: "#94a3b840" },
	unverifiable: { dot: "#94a3b8", soft: "#f1f5f9", ink: "#475569", ring: "#cbd5e1", darkSoft: "#94a3b829", darkInk: "#cbd5e1", darkRing: "#94a3b84d" },
	validated: { dot: "#22c55e", soft: "#dcfce7", ink: "#166534", ring: "#86efac", darkSoft: "#22c55e2e", darkInk: "#86efac", darkRing: "#22c55e59" },
	caveats: { dot: "#86efac", soft: "#f0fdf4", ink: "#15803d", ring: "#bbf7d0", darkSoft: "#4ade801f", darkInk: "#bbf7d0", darkRing: "#4ade8040" },
	repairable: { dot: "#fdba74", soft: "#fff7ed", ink: "#c2410c", ring: "#fed7aa", darkSoft: "#fb923c24", darkInk: "#fdba74", darkRing: "#fb923c4d" },
	questionable: { dot: "#facc15", soft: "#fefce8", ink: "#a16207", ring: "#fde68a", darkSoft: "#facc1524", darkInk: "#fde047", darkRing: "#facc154d" },
	broken: { dot: "#f87171", soft: "#fef2f2", ink: "#b91c1c", ring: "#fecaca", darkSoft: "#f8717129", darkInk: "#fca5a5", darkRing: "#f8717159" },
};

/** A verdict's point on the map and its part of a meter. */
export const verdictDot = (verdict: Verdict) => hex(VERDICT_TONE[verdict].dot);

/** His lines take the verdict of the study they come from: red when it is broken, green when it holds up or can be repaired, grey otherwise. */
export function edgeColour(verdict: Verdict, alpha = 0.85): RGBA {
	const code = verdict === "broken" ? "#ef4444" : verdict === "validated" || verdict === "caveats" || verdict === "repairable" ? "#16a34a" : "#a1a1aa";
	return hex(code, alpha);
}

/** The canvas behind the map, and the ink its labels are written in. */
export const STAGE: Record<Theme, { background: string; ink: RGBA; halo: string; muted: RGBA }> = {
	light: { background: "#f5f6f8", ink: [0.09, 0.11, 0.15, 1], halo: "rgba(245,246,248,0.92)", muted: [0.62, 0.65, 0.7, 1] },
	dark: { background: "#0b0e14", ink: [0.92, 0.94, 0.97, 1], halo: "rgba(11,14,20,0.9)", muted: [0.42, 0.46, 0.52, 1] },
};

export const css = ([r, g, b, a]: RGBA) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

/**
 * A region's colour: its own hue, faded and dusty, so the regions read apart while a rating, saturated, ringed and larger,
 * still stands out from them. Hues go round the wheel in steps far apart, so regions with neighbouring ids never look alike.
 */
const REGION_HUES = [250, 160, 310, 40, 200, 340, 100, 280, 15, 220, 130, 70];
const regionHue = (region: number) => REGION_HUES[region % REGION_HUES.length];
export const regionDot = (region: number, theme: Theme): RGBA => (theme === "dark" ? oklch(0.66, 0.085, regionHue(region), 0.9) : oklch(0.72, 0.06, regionHue(region), 0.8));
/** A region's name, in a deeper shade of its colour. */
export const regionInk = (region: number, theme: Theme, alpha: number): RGBA => (theme === "dark" ? oklch(0.86, 0.1, regionHue(region), alpha) : oklch(0.42, 0.09, regionHue(region), alpha));

/** The page's ink at some strength: everything on the map that is not a check. */
export const inkAt = (theme: Theme, alpha: number): RGBA => [STAGE[theme].ink[0], STAGE[theme].ink[1], STAGE[theme].ink[2], alpha];
