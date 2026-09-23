import HomePage, { type Tone, type Tones } from "@/components/pages/HomePage";
import { getWorldMap } from "@/components/pages/home-map-shapes";
import { contentFrom, defaultContent } from "@/components/pages/home-content";
import { loadHomeData } from "@/components/pages/home-data";
import { formatCssColor, generateColorRamp, parseHexColor, type RgbaColor } from "@/config/library-config/theme";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { getLibraryConfig } from "@/config/library-config/server";
import { redirect } from "@/i18n/routing";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";

// The library's home page, shown at `/` while `features.homePage` is on; otherwise `/` opens the listing.

export async function generateMetadata(): Promise<Metadata> {
	await connection();
	const config = await getLibraryConfig();
	return {
		title: config.identity.name,
		description: config.identity.description ?? config.identity.name,
	};
}

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
function tonesFrom(colors: { accent: string; tertiary: string; backgroundLight: string; backgroundDark: string; cardLight: string; cardDark: string }): { tones: Tones; ramp: Tone[] } {
	const dark = parseHexColor(colors.backgroundDark);
	const light = parseHexColor(colors.cardLight);
	const accent = parseHexColor(colors.accent);
	const tint = mix(accent, parseHexColor(colors.backgroundLight), 0.1);
	const tintDark = mix(accent, dark, 0.12);
	const channels = ([red, green, blue]: RgbaColor) => `${red} ${green} ${blue}`;
	const tone = (bg: RgbaColor, bgDark: RgbaColor): Tone => {
		const fg = readableOn(bg, dark, light);
		const fgDark = readableOn(bgDark, dark, light);
		return { bg: formatCssColor(bg), fg: formatCssColor(fg), fgRgb: channels(fg), bgDark: formatCssColor(bgDark), fgDark: formatCssColor(fgDark), fgRgbDark: channels(fgDark) };
	};
	const tertiary = generateColorRamp(colors.tertiary);
	// The accent at the lightest shade whose text meets WCAG AAA (7:1), for a band set entirely in the accent.
	const accentRamp = generateColorRamp(colors.accent);
	const deep = ([400, 300, 200, 100, 50] as const).map((shade) => accentRamp[shade]).find((shade) => wcagRatio(readableOn(shade, dark, light), shade) >= 7) ?? accentRamp[50];
	return {
		tones: {
			page: tone(parseHexColor(colors.backgroundLight), parseHexColor(colors.backgroundDark)),
			card: tone(parseHexColor(colors.cardLight), parseHexColor(colors.cardDark)),
			tint: tone(tint, tintDark),
			accent: tone(accent, accent),
			tertiary: tone(tertiary[500], tertiary[600]),
			deep: tone(deep, deep),
		},
		ramp: Array.from({ length: RAMP_STEPS }, (_, index) => {
			const amount = 1 - (0.84 * index) / (RAMP_STEPS - 1);
			return tone(mix(accent, light, amount), mix(accent, parseHexColor(colors.cardDark), amount));
		}),
	};
}
// No loading boundary: the page waits only for the library settings, so the first response is the finished page
// rather than a spinner; the figures stream in behind it.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export default async function Home({ params }: Props) {
	await connection();
	const config = await getLibraryConfig();
	// The proxy already sends a bare `/` to the listing; this covers the address with a locale in front, which reaches the page.
	if (!isLibraryFeatureEnabled(config.features, "homePage")) redirect({ href: "/lib", locale: (await params).locale });
	const { locale } = await params;
	const t = await getTranslations({ locale, namespace: "homePage" });
	const about = config.home
		? contentFrom(config.home, { arrival: t("stepArrival"), check: t("stepCheck"), publication: t("stepPublication") })
		: defaultContent(config.identity.name);
	// Not awaited: the page renders now and each part built from these figures streams in when they arrive.
	const data = loadHomeData(new Date(), locale, config.home);
	const { shapes } = await getWorldMap();
	return (
		<HomePage
			{...tonesFrom(config.theme.colors)}
			shapes={shapes}
			name={config.identity.name}
			siteUrl={config.identity.baseUrl}
			contactEmail={config.contact.email ?? null}
			today={new Date().toISOString().slice(0, 10)}
			about={about}
			data={data}
		/>
	);
}

type Props = { params: Promise<{ locale: string }> };
