import { isLibraryFeatureEnabled, type LibraryFeatures } from "@/config/library-config/features";

/** A library setting the header can offer: light or dark, and the language. */
export type NavbarSetting = "theme" | "language";

/** One control in the header's actions. */
export type NavbarActionSlot =
	/** A single setting, shown as its own control. */
	| { kind: "setting"; setting: NavbarSetting }
	/** Two or more settings behind one settings button. */
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
 * links still fit beside them. Each step folds one more thing into a menu:
 * first the settings go behind one button, then Sign in joins them. A menu that
 * would hold a single item shows that item's own control instead, so a step
 * that changes nothing is left out. Below the last step the links fold into
 * the phone menu.
 */
export function navbarActionSteps(settings: readonly NavbarSetting[], signIn: boolean): NavbarActionSlot[][] {
	const signInSlot: NavbarActionSlot[] = signIn ? [{ kind: "signIn" }] : [];
	const steps: NavbarActionSlot[][] = [
		[...settings.map((setting): NavbarActionSlot => ({ kind: "setting", setting })), ...signInSlot],
	];
	if (settings.length > 1) steps.push([{ kind: "settingsMenu" }, ...signInSlot]);
	if (signIn && settings.length > 0) steps.push([{ kind: "menu" }]);
	return steps;
}
