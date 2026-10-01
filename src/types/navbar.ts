import type { MockReader } from "@/components/layout/navbar/MockReaderSession";
import type { LibraryFeatures } from "@/config/library-config/features";

// Breakpoint definitions matching Tailwind config
// mobile: < xl (< 1280px)
// tablet: xl to 2xl (1280px - 1536px)
// desktop: 2xl+ (>= 1536px)
export type NavbarBreakpoint = "mobile" | "tablet" | "desktop";

// Where an element can be placed at each breakpoint
export type NavbarPlacement = "inline" | "dropdown" | "mobileMenu" | "hidden";

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
		session: MockReader | null
	) => boolean;
	// Where element appears at each breakpoint
	placement: Record<NavbarBreakpoint, NavbarPlacement>;
	// Component to render
	component: React.ComponentType<NavbarElementProps>;
	// Sort order within placement container (lower = first)
	order?: number;
}

// Context passed to container components
export interface NavbarContext {
	session: MockReader | null;
	styleVariant: NavbarStyleVariant;
	theme: string | undefined;
	setTheme: (theme: string) => void;
	onLoginModalOpen: () => void;
}

// Helper type for grouping elements by placement
export type ElementsByPlacement = {
	inline: NavbarElementConfig[];
	dropdown: NavbarElementConfig[];
	mobileMenu: NavbarElementConfig[];
	hidden: NavbarElementConfig[];
};
