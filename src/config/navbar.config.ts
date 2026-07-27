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
 * - placement: Where element appears at each breakpoint
 *   - mobile (<xl): 'inline' = visible outside hamburger, 'mobileMenu' = inside hamburger
 *   - tablet (xl-2xl): 'inline' = visible, 'dropdown' = inside condensed dropdown
 *   - desktop (2xl+): 'inline' = expanded/visible
 * - component: React component to render
 * - order: Sort order within placement container (lower = first)
 */
export const navbarElements: NavbarElementConfig[] = [
	{
		id: "theme-switcher",
		enabled: (features) =>
			isLibraryFeatureEnabled(features, "themeSwitcher"),
		placement: {
			mobile: "mobileMenu", // In hamburger menu
			tablet: "dropdown", // In condensed dropdown
			desktop: "inline", // Expanded inline
		},
		component: ThemeSwitcher,
		order: 1,
	},
	{
		id: "language-switcher",
		enabled: (features) =>
			isLibraryFeatureEnabled(features, "languageSwitcher"),
		placement: {
			mobile: "mobileMenu", // In hamburger menu
			tablet: "dropdown", // In condensed dropdown
			desktop: "inline", // Expanded inline
		},
		component: LanguageSwitcher,
		order: 2,
	},
	{
		id: "login-button",
		enabled: (features, session) =>
			isLibraryFeatureEnabled(features, "login") && !session,
		placement: {
			mobile: "inline", // Always visible on mobile (outside hamburger)
			tablet: "dropdown", // In condensed dropdown
			desktop: "inline", // Expanded inline
		},
		component: LoginButton,
		order: 3,
	},
	{
		id: "user-menu",
		enabled: (_, session) => !!session,
		placement: {
			mobile: "inline", // Avatar visible on mobile (outside hamburger)
			tablet: "dropdown", // Profile/logout in condensed dropdown
			desktop: "inline", // Avatar with dropdown
		},
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
 * Helper function to get elements by placement for a specific breakpoint
 */
export function getElementsByPlacement(
	elements: NavbarElementConfig[],
	breakpoint: "mobile" | "tablet" | "desktop",
	placement: "inline" | "dropdown" | "mobileMenu" | "hidden"
): NavbarElementConfig[] {
	return elements
		.filter((el) => el.placement[breakpoint] === placement)
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
