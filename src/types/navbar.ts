import type { Reader } from "@/components/layout/navbar/ReaderSession";
import type { LibraryFeatures } from "@/config/library-config/features";

/**
 * Where an element sits once the links fold into the phone menu: beside the
 * menu button, or inside the menu. Wider than that, the header's measured
 * steps place the actions (`navbarActionSteps`).
 */
export type NavbarPlacement = "inline" | "mobileMenu";

// Style variants from the runtime library configuration
export type NavbarStyleVariant = "small" | "wide";

// Component render variants
export type NavbarElementVariant = "inline" | "menuItem";

// Props passed to all navbar element components
export interface NavbarElementProps {
	variant: NavbarElementVariant;
	styleVariant: NavbarStyleVariant;
	onAction?: () => void;
	showLabel?: boolean; // Whether to show text label (used in mobile menu)
}

// Configuration for a single navbar element
export interface NavbarElementConfig {
	id: string;
	// Function to determine if element should be rendered
	enabled: (
		features: LibraryFeatures,
		session: Reader | null
	) => boolean;
	placement: NavbarPlacement;
	// Component to render
	component: React.ComponentType<NavbarElementProps>;
	// Sort order within placement container (lower = first)
	order?: number;
}

// Context passed to container components
export interface NavbarContext {
	session: Reader | null;
	styleVariant: NavbarStyleVariant;
	theme: string | undefined;
	setTheme: (theme: string) => void;
}
