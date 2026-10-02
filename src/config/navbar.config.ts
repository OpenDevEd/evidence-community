import type { NavbarElementConfig } from "@/types/navbar";
import ThemeSwitcher from "@/components/layout/navbar/ThemeSwitcher";
import LanguageSwitcher from "@/components/layout/navbar/LanguageSwitcher";
import LoginButton from "@/components/layout/navbar/LoginButton";
import UserMenu from "@/components/layout/navbar/UserMenu";
import {
	isLibraryFeatureEnabled,
	type LibraryFeatures,
} from "@/config/library-config/features";

/**
 * Navbar Elements Configuration
 *
 * Each element defines:
 * - id: Unique identifier
 * - enabled: Function to check if an element should render from runtime
 *   features and session state
 * - placement: once the links fold into the phone menu, 'inline' stays beside
 *   the menu button and 'mobileMenu' goes inside it. Wider than that, the
 *   header's measured steps place the actions (src/lib/navbar-actions.ts).
 * - component: React component to render
 * - order: Sort order within placement container (lower = first)
 */
export const navbarElements: NavbarElementConfig[] = [
	{
		id: "theme-switcher",
		enabled: (features) =>
			isLibraryFeatureEnabled(features, "themeSwitcher"),
		placement: "mobileMenu",
		component: ThemeSwitcher,
		order: 1,
	},
	{
		id: "language-switcher",
		enabled: (features) =>
			isLibraryFeatureEnabled(features, "languageSwitcher"),
		placement: "mobileMenu",
		component: LanguageSwitcher,
		order: 2,
	},
	{
		id: "login-button",
		enabled: (features, session) =>
			isLibraryFeatureEnabled(features, "readerAccounts") && !session,
		placement: "inline",
		component: LoginButton,
		order: 3,
	},
	{
		id: "user-menu",
		enabled: (_, session) => !!session,
		placement: "inline",
		component: UserMenu,
		order: 4,
	},
];

/**
 * Helper function to filter enabled elements
 */
export function getEnabledElements(
	features: LibraryFeatures,
	session: any
): NavbarElementConfig[] {
	return navbarElements.filter((el) => el.enabled(features, session));
}

/**
 * The enabled elements with this placement on a phone, in order.
 */
export function getElementsByPlacement(
	elements: NavbarElementConfig[],
	placement: NavbarElementConfig["placement"],
): NavbarElementConfig[] {
	return elements
		.filter((el) => el.placement === placement)
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
