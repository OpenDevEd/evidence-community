import "server-only";

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { getTranslations } from "next-intl/server";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getVisibleRuntimeLinks } from "@/config/library-config/links";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { localizeOrUseIfCapitalized } from "@/lib/utils";
import { localesNames } from "@/i18n/routing";

/**
 * How wide the header bar has to be before its links fit, and before the
 * actions (theme, language, Sign in or the reader's avatar) fit beside them
 * instead of in a menu. Measured with the library's own font, so a library with
 * a few short links keeps the full row on a small laptop and one with many long
 * links switches earlier. The numbers become container queries on the bar.
 */
export type NavbarFit = { links: number; full: number };

// The sizes the navbar's classes give its parts (navbar/index.tsx, NavLinks,
// LoginButton, ThemeSwitcher, LanguageSwitcher), in pixels.
const GAP = 24; // gap-6 in the bar, between links and between actions
const LINK_ICON = 24; // size-6
const LINK_ICON_GAP = 8; // gap-2
const LINK_FONT = { size: 18, weight: 500 }; // text-lg font-medium
const SUBMENU_TRIGGER = 8 + 40; // gap-2, then the chevron button
const MENU_BUTTON = 20; // the condensed ☰ trigger
const THEME_BUTTON = 20; // size-5 icon, no padding
const AVATAR = 40; // md avatar
const SIGN_IN_CHROME = 16 + 20 + 8 + 16; // px-4, icon, gap, px-4
const LANGUAGE_CHROME = 8 + 20 + 8 + 8 + 16 + 8; // px-2, icon, gap, gap, chevron, px-2
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
	const text = (value: string) => context.measureText(value).width;

	const t = await getTranslations({ locale, namespace: "nav" });
	const ui = await getTranslations({ locale, namespace: "ui" });
	const wide = config.theme.layout === "wide";
	const label = (value: string) => (wide ? value.toUpperCase() : value);

	const items = getVisibleRuntimeLinks(config.navigation.links).map(
		(link) =>
			(link.icon ? LINK_ICON + LINK_ICON_GAP : 0) +
			text(label(localizeOrUseIfCapitalized(link.label, t))) +
			(getVisibleRuntimeLinks(link.children).length > 0 ? SUBMENU_TRIGGER : 0),
	);
	if (config.gapMaps.length > 0) items.push(LINK_ICON + LINK_ICON_GAP + text(label(t("gapMaps"))));
	const links = items.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, items.length - 1);

	const actions: number[] = [];
	if (isLibraryFeatureEnabled(config.features, "themeSwitcher")) actions.push(THEME_BUTTON);
	if (isLibraryFeatureEnabled(config.features, "languageSwitcher")) {
		// The switcher shows the current language's name; the longest decides.
		const names = config.localization.locales.map((code) => localesNames[code as keyof typeof localesNames] ?? code);
		actions.push(LANGUAGE_CHROME + Math.max(...names.map((name) => text(name))));
	}
	// Signed out shows Sign in, signed in the avatar; the wider one decides.
	if (isLibraryFeatureEnabled(config.features, "login")) actions.push(Math.max(SIGN_IN_CHROME + text(ui("signIn")), AVATAR));
	const actionsWidth = actions.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, actions.length - 1);

	const logo = await logoWidth(logoSrc);
	// Container queries measure the bar without its padding.
	const base = logo + GAP + links + SAFETY;
	return {
		links: Math.ceil(base + (actions.length > 0 ? GAP + MENU_BUTTON : 0)),
		full: Math.ceil(base + (actions.length > 0 ? GAP + actionsWidth : 0)),
	};
}
