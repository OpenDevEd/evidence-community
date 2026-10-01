import { isLibraryFeatureEnabled, type LibraryFeatures } from "@/config/library-config/features";

/** A library setting the header can offer: light or dark, and the language. */
export type NavbarSetting = "theme" | "language";

/** One control in the header's actions. */
export type NavbarActionSlot =
	/** The light or dark switch, when it is the only setting. */
	| { kind: "theme" }
	/** The settings behind one settings button. */
	| { kind: "settingsMenu" }
	/** The Sign in button. */
	| { kind: "signIn" }
	/** The settings and Sign in together behind one menu button. */
	| { kind: "menu" };

/** The settings this library offers in its header. */
export function navbarSettings(config: {
	features: LibraryFeatures;
	localization: { locales: readonly string[] };
}): NavbarSetting[] {
	return [
		...(isLibraryFeatureEnabled(config.features, "themeSwitcher") ? (["theme"] as const) : []),
		...(isLibraryFeatureEnabled(config.features, "languageSwitcher") && config.localization.locales.length > 1
			? (["language"] as const)
			: []),
	];
}

/**
 * The header's actions from the widest arrangement to the narrowest, while the
 * links still fit beside them. The languages always open from the settings
 * menu; the light or dark switch shows as its own button when it is the only
 * setting. Narrower, Sign in joins the settings in one menu. Below the last
 * step the links fold into the phone menu.
 */
export function navbarActionSteps(settings: readonly NavbarSetting[], signIn: boolean): NavbarActionSlot[][] {
	const signInSlot: NavbarActionSlot[] = signIn ? [{ kind: "signIn" }] : [];
	const settingSlots: NavbarActionSlot[] =
		settings.length === 0 ? [] : settings.includes("language") ? [{ kind: "settingsMenu" }] : [{ kind: "theme" }];
	const steps = [[...settingSlots, ...signInSlot]];
	if (signIn && settings.length > 0) steps.push([{ kind: "menu" }]);
	return steps;
}
