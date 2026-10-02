import "server-only";

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { getTranslations } from "next-intl/server";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getVisibleRuntimeLinks } from "@/config/library-config/links";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { localizeOrUseIfCapitalized } from "@/lib/utils";
import { navbarActionSteps, navbarSettings, type NavbarActionSlot } from "@/lib/navbar-actions";

/**
 * How wide the header bar has to be for each arrangement of its actions
 * (`navbarActionSteps`), widest first. Below the last one the links fold into
 * the phone menu. Measured with the library's own font, so a library with a few
 * short links keeps every control in the row on a small laptop and one with
 * many long links folds earlier. The numbers become container queries on the
 * bar.
 */
export type NavbarFit = { steps: number[] };

// The sizes the navbar's classes give its parts (navbar/index.tsx, NavLinks,
// LoginButton, ThemeSwitcher, LanguageSwitcher), in pixels.
const GAP = 24; // gap-6 in the bar, between links and between actions
const LINK_ICON = 24; // size-6
const LINK_ICON_GAP = 8; // gap-2
const LINK_FONT = { size: 18, weight: 500 }; // text-lg font-medium
const SUBMENU_TRIGGER = 8 + 40; // gap-2, then the chevron button
const MENU_BUTTON = 20; // the ☰ trigger, a size-5 icon with no padding
const SETTINGS_BUTTON = 20; // the settings trigger, likewise
const THEME_BUTTON = 20; // the light or dark button, likewise
const AVATAR = 40; // md avatar
const SIGN_IN_CHROME = 16 + 20 + 8 + 16; // px-4, icon, gap, px-4
const LOGO_HEIGHT = 40; // xl:h-10
const LOGO_MAX_WIDTH = 192; // max-w-logo-header (12rem)
/** Headroom for rounding and font rendering differences between browsers. */
const SAFETY = 8;

const fontCache = new Map<string, Promise<string | null>>();

/** Registers a Google font weight with the canvas and answers its alias. */
function loadGoogleFont(family: string, weight: number) {
	const key = `${family}:${weight}`;
	let pending = fontCache.get(key);
	if (!pending) {
		pending = (async () => {
			const query = `family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${weight}`;
			// An old browser's user agent makes Google answer with TrueType, which the canvas reads.
			const css = await fetch(`https://fonts.googleapis.com/css2?${query}`, {
				headers: { "User-Agent": "Mozilla/4.0" },
				signal: AbortSignal.timeout(5_000),
			}).then((response) => (response.ok ? response.text() : ""));
			const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
			if (!url) return null;
			const file = await fetch(url, { signal: AbortSignal.timeout(5_000) }).then((response) =>
				response.ok ? response.arrayBuffer() : null,
			);
			if (!file) return null;
			const alias = `navbar-fit-${family}-${weight}`;
			GlobalFonts.register(Buffer.from(file), alias);
			return alias;
		})().catch(() => null);
		fontCache.set(key, pending);
	}
	return pending;
}

const logoCache = new Map<string, Promise<number>>();

/** The logo's width at the header's height, as its image proportions give it. */
function logoWidth(src: string | undefined) {
	if (!src) return Promise.resolve(LOGO_MAX_WIDTH);
	let pending = logoCache.get(src);
	if (!pending) {
		pending = fetch(src, { signal: AbortSignal.timeout(5_000) })
			.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
			.then((file) => loadImage(Buffer.from(file)))
			.then((image) => Math.min(LOGO_MAX_WIDTH, (LOGO_HEIGHT * image.width) / image.height))
			.catch(() => LOGO_MAX_WIDTH);
		logoCache.set(src, pending);
	}
	return pending;
}

type NavbarLabels = {
	/** A navigation link's label as the header shows it. */
	link: (label: string) => string;
	gapMaps: string;
	signIn: string;
};

/** How wide one control in the header's actions is. */
function slotWidth(slot: NavbarActionSlot, measure: (value: string) => number, labels: NavbarLabels) {
	switch (slot.kind) {
		case "theme":
			return THEME_BUTTON;
		case "settingsMenu":
			return SETTINGS_BUTTON;
		case "signIn":
			return SIGN_IN_CHROME + measure(labels.signIn);
		case "menu":
			return MENU_BUTTON;
	}
}

/**
 * The widths the bar needs for each arrangement of its actions, given a way to
 * measure text in the library's font. Signed in, the avatar alone stands in
 * for every arrangement, so each keeps the larger of the two and nothing jumps
 * when a reader signs in.
 */
export function navbarWidths(
	config: LibraryServerConfig,
	measure: (value: string) => number,
	labels: NavbarLabels,
	logo: number,
): NavbarFit {
	const wide = config.theme.layout === "wide";
	const label = (value: string) => (wide ? value.toUpperCase() : value);
	const items = getVisibleRuntimeLinks(config.navigation.links).map(
		(link) =>
			(link.icon ? LINK_ICON + LINK_ICON_GAP : 0) +
			measure(label(labels.link(link.label))) +
			(getVisibleRuntimeLinks(link.children).length > 0 ? SUBMENU_TRIGGER : 0),
	);
	if (config.gapMaps.length > 0) items.push(LINK_ICON + LINK_ICON_GAP + measure(label(labels.gapMaps)));
	const links = items.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, items.length - 1);

	const readerAccounts = isLibraryFeatureEnabled(config.features, "readerAccounts");
	// Container queries measure the bar without its padding.
	const base = logo + GAP + links + SAFETY;
	return {
		steps: navbarActionSteps(navbarSettings(config), readerAccounts).map((slots) => {
			const signedOut =
				slots.reduce((sum, slot) => sum + slotWidth(slot, measure, labels), 0) + GAP * Math.max(0, slots.length - 1);
			const actions = Math.max(signedOut, readerAccounts ? AVATAR : 0);
			return Math.ceil(base + (actions > 0 ? GAP + actions : 0));
		}),
	};
}

/**
 * Which arrangement of the header shows, as CSS. Each measured width becomes a
 * container query on the bar; the widest that fits wins. Without a measurement
 * the fixed xl and 2xl breakpoints decide between the narrowest and the widest
 * arrangement.
 */
export function navbarFitCss(fit: NavbarFit | null, stepCount: number) {
	const queries = fit
		? fit.steps.map((width) => `@container navbar (min-width: ${width}px)`)
		: Array.from({ length: stepCount }, (_, step) =>
				// The narrowest step takes the links' breakpoint, even when it is the only one.
				step === stepCount - 1 ? "@media (min-width: 1280px)" : step === 0 ? "@media (min-width: 1536px)" : null,
			);
	// Narrowest first, so a wider arrangement that also fits overrides it.
	const rules = queries
		.map((query, step) => ({ query, step }))
		.filter((rule): rule is { query: string; step: number } => rule.query !== null)
		.reverse()
		.map(
			({ query, step }) => `${query} {
	.nf-step { display: none !important; }
	.nf-step-${step} { display: flex !important; }
	.nf-links { display: flex !important; }
	.nf-compact { display: none !important; }
}`,
		);
	return `
.navbar-bar { container: navbar / inline-size; }
.nf-links, .nf-step { display: none !important; }
${rules.join("\n")}`;
}

export async function computeNavbarFit(
	config: LibraryServerConfig,
	locale: string,
	logoSrc: string | undefined,
): Promise<NavbarFit | null> {
	const body = config.theme.fonts.body;
	if (body.source !== "google") return null;
	const alias = await loadGoogleFont(body.family, LINK_FONT.weight);
	if (!alias) {
		console.warn("[navbar-fit] could not load the body font; using the fixed breakpoints", {
			family: body.family,
		});
		return null;
	}
	const context = createCanvas(1, 1).getContext("2d");
	context.font = `${LINK_FONT.weight} ${LINK_FONT.size}px "${alias}"`;
	const [t, ui, logo] = await Promise.all([
		getTranslations({ locale, namespace: "nav" }),
		getTranslations({ locale, namespace: "ui" }),
		logoWidth(logoSrc),
	]);
	return navbarWidths(
		config,
		(value) => context.measureText(value).width,
		{
			link: (value) => localizeOrUseIfCapitalized(value, t),
			gapMaps: t("gapMaps"),
			signIn: ui("signIn"),
		},
		logo,
	);
}

