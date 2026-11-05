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
export type NavbarFit = { steps: number[]; arrangements: Arrangement[]; /** The logo's width at the header's height, before the cap. */ logo: number };

/** Which name shows beside the logo: the library's full name, its short name, or none. */
type NameShown = "full" | "short" | "none";
/**
 * One way the bar can be laid out and the width it needs: an arrangement of the actions with the links inline (`step`), or the
 * phone menu ("compact"), each with a name beside the logo.
 */
type Arrangement = { width: number; step: number | "compact"; name: NameShown };

// The sizes the navbar's classes give its parts (navbar/index.tsx, NavLinks,
// LoginButton, ThemeSwitcher, LanguageSwitcher), in pixels.
const GAP = 24; // gap-6 in the bar, between links and between actions
const LINK_ICON = 24; // size-6
const LINK_ICON_GAP = 8; // gap-2
const LINK_FONT = { size: 18, weight: 500 }; // text-lg font-medium
const SUBMENU_TRIGGER = 8 + 40; // gap-2, then the chevron button
const MENU_BUTTON = 20; // the ☰ trigger, a size-5 icon with no padding
const PHONE_MENU_BUTTON = 32; // the same trigger on a phone, with its padding
const SETTINGS_BUTTON = 20; // the settings trigger, likewise
const THEME_BUTTON = 20; // the light or dark button, likewise
const AVATAR = 40; // md avatar
const SIGN_IN_CHROME = 16 + 20 + 8 + 16; // px-4, icon, gap, px-4
const LOGO_HEIGHT = 40; // xl:h-10
const LOGO_MAX_WIDTH = 192; // max-w-logo-header (12rem)
const NAME_FONT = { size: 24, weight: 500 }; // the name beside the logo: text-2xl font-medium
const NAME_GAP = 12; // the ps-3 before the name, which sets it apart from the logo
/** Headroom for rounding and font rendering differences between browsers. */
const SAFETY = 8;

const fontCache = new Map<string, Promise<string | null>>();
/**
 * A failed load is tried again after this long. A slow font server on a
 * worker's first page would otherwise leave the header on the fixed
 * breakpoints until the process restarts.
 */
const FONT_RETRY_MS = 60_000;

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
		void pending.then((alias) => {
			if (!alias) setTimeout(() => fontCache.delete(key), FONT_RETRY_MS).unref();
		});
	}
	return pending;
}

const logoCache = new Map<string, Promise<number>>();

/** The logo's width at the header's height, as its image proportions give it, before the header's 12rem cap. */
function logoWidth(src: string | undefined) {
	if (!src) return Promise.resolve(LOGO_MAX_WIDTH);
	let pending = logoCache.get(src);
	if (!pending) {
		pending = fetch(src, { signal: AbortSignal.timeout(5_000) })
			.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
			.then((file) => loadImage(Buffer.from(file)))
			.then((image) => (LOGO_HEIGHT * image.width) / image.height)
			.catch(() => LOGO_MAX_WIDTH);
		logoCache.set(src, pending);
	}
	return pending;
}

/** The wider of the logos at the header's height; the cap's width without one. */
async function widestLogo(srcs: readonly (string | undefined)[]) {
	const widths = await Promise.all((srcs.length ? srcs : [undefined]).map(logoWidth));
	return Math.max(...widths);
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
	logoWidth: number,
	measureName: (value: string) => number = () => 0,
): NavbarFit {
	const logo = Math.min(LOGO_MAX_WIDTH, logoWidth);
	const items = getVisibleRuntimeLinks(config.navigation.links).map(
		(link) =>
			(link.icon ? LINK_ICON + LINK_ICON_GAP : 0) +
			measure(labels.link(link.label)) +
			(getVisibleRuntimeLinks(link.children).length > 0 ? SUBMENU_TRIGGER : 0),
	);
	if (config.gapMaps.length > 0) items.push(LINK_ICON + LINK_ICON_GAP + measure(labels.gapMaps));
	const links = items.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, items.length - 1);

	const readerAccounts = isLibraryFeatureEnabled(config.features, "readerAccounts");
	// Container queries measure the bar without its padding.
	const base = logo + GAP + links + SAFETY;
	const actions = navbarActionSteps(navbarSettings(config), readerAccounts).map((slots) => {
		const signedOut =
			slots.reduce((sum, slot) => sum + slotWidth(slot, measure, labels), 0) + GAP * Math.max(0, slots.length - 1);
		const width = Math.max(signedOut, readerAccounts ? AVATAR : 0);
		return width > 0 ? GAP + width : 0;
	});
	const steps = actions.map((width) => Math.ceil(base + width));
	const name = nameWidths(config, measureName);
	// On a phone the bar holds the logo, the empty links slot (no width, but a gap), the sign-in or avatar and the menu button
	// with its padding. The sign-in is a 40px circle like the avatar, and shows its label from 640px.
	const phone = SAFETY + logo + GAP + GAP + PHONE_MENU_BUTTON;
	const compact = {
		icon: phone + (readerAccounts ? GAP + AVATAR : 0),
		label: phone + (readerAccounts ? GAP + Math.max(AVATAR, SIGN_IN_CHROME + measure(labels.signIn)) : 0),
	};
	return { steps, arrangements: arrangementsOf(steps, name, compact), logo: logoWidth };
}

/** The widths the full and the short name take beside the logo, the short one only where it differs. */
function nameWidths(config: LibraryServerConfig, measureName: (value: string) => number) {
	const { name, shortName, showName } = config.identity;
	// A header without the name has nothing beside the logo to fit.
	if (!showName) return { full: 0, short: null };
	const full = NAME_GAP + measureName(name);
	// A short name no narrower than the full one would only ever stand in for it.
	const short = shortName && shortName !== name ? NAME_GAP + measureName(shortName) : Infinity;
	return { full, short: short < full ? short : null };
}

/**
 * Every arrangement the bar can take, widest first. With the links inline: the full name while every action fits beside it,
 * then the short name while the actions fold away, then the logo alone with the fewest actions. With the links in the phone
 * menu the bar has room again: the full name, else the short name, else the logo alone.
 */
function arrangementsOf(steps: number[], name: { full: number; short: number | null }, compact: PhoneBar): Arrangement[] {
	const last = steps.length - 1;
	const short = name.short ?? name.full;
	const inline: Arrangement[] = [
		{ width: Math.ceil(steps[0] + name.full), step: 0, name: "full" },
		...steps.map((width, step): Arrangement => ({ width: Math.ceil(width + short), step, name: name.short === null ? "full" : "short" })),
		{ width: steps[last], step: last, name: "none" },
	];
	const names: [NameShown, number][] = name.short === null ? [["full", name.full]] : [["full", name.full], ["short", name.short]];
	// A phone arrangement only where the links don't fit, so one with a wider name never wins over the links inline.
	return [...inline, ...phoneArrangements(compact, names).filter((arrangement) => arrangement.width < steps[last])];
}

/** The bar's width at 640px, less its 16px padding each side: from there the sign-in shows its label. */
const SM_BAR = 640 - 2 * 16;
/** The phone bar's width without a name: with the sign-in as an icon (below 640px) and with its label (from 640px). */
type PhoneBar = { icon: number; label: number };

/**
 * The phone bar's arrangements, each name (the full one first) where it fits beside the icon below 640px, then from 640px the
 * name that fits beside the labelled sign-in, and wider names as the bar grows.
 */
function phoneArrangements(bar: PhoneBar, names: [NameShown, number][]): Arrangement[] {
	const phone = (width: number, name: NameShown): Arrangement => ({ width: Math.ceil(width), step: "compact", name });
	const below = names.filter(([, width]) => bar.icon + width < SM_BAR).map(([name, width]) => phone(bar.icon + width, name));
	const atLabel = names.find(([, width]) => bar.label + width <= SM_BAR)?.[0] ?? "none";
	const from = bar.label === bar.icon ? [] : [phone(SM_BAR, atLabel)];
	const above = names.filter(([, width]) => bar.label + width > SM_BAR).map(([name, width]) => phone(bar.label + width, name));
	return [...below, ...from, ...above];
}

/** What one arrangement shows, as declarations inside its container query. */
/** A width as CSS, to the hundredth of a pixel: rounding to whole pixels would move the bar when the logo lands. */
/** The widths are measured at the browser's default text size; a query in rem follows a reader's larger text. */
const ROOT_PX = 16;
const pixels = (width: number) => `${Math.round(width * 100) / 100}px`;

function arrangementCss({ step, name }: Arrangement) {
	const actions =
		step === "compact"
			? ""
			: `.nf-step { display: none !important; }
	.nf-step-${step} { display: flex !important; }
	.nf-links { display: flex !important; }
	.nf-compact { display: none !important; }`;
	return `${actions}
	.nf-name { display: none !important; }
	${name === "none" ? "" : `.nf-name-${name} { display: inline !important; }`}`;
}

/**
 * Which arrangement of the header shows, as CSS. Each measured width becomes a
 * container query on the bar; the widest that fits wins. Without a measurement
 * the fixed xl and 2xl breakpoints decide between the narrowest and the widest
 * arrangement.
 */
export function navbarFitCss(fit: NavbarFit | null, stepCount: number) {
	if (fit) {
		// Narrowest first, so a wider arrangement that also fits overrides it.
		const rules = [...fit.arrangements]
			.sort((a, b) => a.width - b.width)
			.map((arrangement) => `@container navbar (min-width: ${arrangement.width / ROOT_PX}rem) {
	${arrangementCss(arrangement)}
}`);
		// The logo's box holds its own width while the picture loads, so the name and links beside it never move when it lands.
		// It is drawn 36px tall below 1,280px and 40px from there, as LIBRARY_LOGO_SIZES.header says.
		return `
.navbar-bar { container: navbar / inline-size; --nf-logo-width: ${pixels(Math.min(LOGO_MAX_WIDTH, fit.logo * 0.9))}; }
@media (min-width: 1280px) { .navbar-bar { --nf-logo-width: ${pixels(Math.min(LOGO_MAX_WIDTH, fit.logo))}; } }
.nf-links, .nf-step, .nf-name { display: none !important; }
${rules.join("\n")}`;
	}
	// Without a measurement the fixed xl and 2xl breakpoints decide. The header's name shows only with the widest of several
	// arrangements, from 2xl: the short one, or the full one when it has none (the last name the logo draws).
	const queries = Array.from({ length: stepCount }, (_, step) =>
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
	.nf-compact { display: none !important; }${step === 0 && stepCount > 1 ? "\n\t.navbar-bar .nf-name:last-child { display: inline !important; }" : ""}
}`,
		);
	return `
.navbar-bar { container: navbar / inline-size; }
.nf-links, .nf-step, .nf-name { display: none !important; }
${rules.join("\n")}`;
}

/** `logoSrcs`: the light and dark logos. The bar keeps room for the wider, as either may show. */
export async function computeNavbarFit(
	config: LibraryServerConfig,
	locale: string,
	logoSrcs: readonly (string | undefined)[],
): Promise<NavbarFit | null> {
	const body = config.theme.fonts.body;
	if (body.source !== "google") return null;
	const [alias, nameAlias] = await Promise.all([loadGoogleFont(body.family, LINK_FONT.weight), loadGoogleFont(body.family, NAME_FONT.weight)]);
	if (!alias) {
		console.warn("[navbar-fit] could not load the body font; using the fixed breakpoints", {
			family: body.family,
		});
		return null;
	}
	const context = createCanvas(1, 1).getContext("2d");
	context.font = `${LINK_FONT.weight} ${LINK_FONT.size}px "${alias}"`;
	const nameContext = createCanvas(1, 1).getContext("2d");
	nameContext.font = `${NAME_FONT.weight} ${NAME_FONT.size}px "${nameAlias ?? alias}"`;
	const [t, ui, logo] = await Promise.all([
		getTranslations({ locale, namespace: "nav" }),
		getTranslations({ locale, namespace: "ui" }),
		widestLogo(logoSrcs),
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
		(value) => nameContext.measureText(value).width,
	);
}

