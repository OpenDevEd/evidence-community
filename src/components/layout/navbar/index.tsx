"use client";

import { useContext } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { useDisclosure } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { usePathname } from "@/i18n/routing";
import { style } from "@/../tailwind.config";
import { FeatureFlagsContext } from "@/context/Providers";

import { Logo } from "./Logo";
import NavLinks from "./NavLinks";
import NavbarSearch from "./NavbarSearch";
import LoginModal from "./LoginModal";
import MobileMenu from "./MobileMenu";
import ActionsDropdown from "./ActionsDropdown";

import {
	navbarElements,
	getEnabledElements,
	getElementsByPlacement,
} from "@/config/navbar.config";
import { isFeatureFlagEnabled } from "@/lib/feature-flags";

import type {
	NavbarContext as NavbarContextType,
	NavbarStyleVariant,
} from "@/types/navbar";

export default function Navbar() {
	const t = useTranslations("ui");
	const pathname = usePathname();
	const { resolvedTheme: theme, setTheme } = useTheme();
	const { data: session } = useSession();
	const { featureFlags } = useContext(FeatureFlagsContext);
	const styleVariant = (style as NavbarStyleVariant) || "small";

	const {
		isOpen: isLoginModalOpen,
		onOpen: onLoginModalOpen,
		onOpenChange: onLoginModalOpenChange,
		onClose: onLoginModalClose,
	} = useDisclosure();

	const isMapPage = pathname.includes("/map");

	// The navbar search routes to the library listing, so hide it on pages that
	// already own a search bar (the listing, the map, and a user's profile).
	const isSearchOwningPath =
		pathname === "/lib" ||
		pathname.startsWith("/map") ||
		pathname.startsWith("/profile");
	const showNavbarSearch =
		isFeatureFlagEnabled(featureFlags ?? {}, "navbar-search") &&
		!isSearchOwningPath;

	// Get enabled elements based on feature flags and session
	const enabledElements = getEnabledElements(
		featureFlags ?? {},
		session
	);

	// Get elements grouped by placement for each breakpoint
	const mobileInlineElements = getElementsByPlacement(
		enabledElements,
		"mobile",
		"inline"
	);
	const mobileMenuElements = getElementsByPlacement(
		enabledElements,
		"mobile",
		"mobileMenu"
	);
	const tabletDropdownElements = getElementsByPlacement(
		enabledElements,
		"tablet",
		"dropdown"
	);
	const desktopInlineElements = getElementsByPlacement(
		enabledElements,
		"desktop",
		"inline"
	);

	// Context passed to container components
	const navbarContext: NavbarContextType = {
		featureFlags: featureFlags ?? {},
		session,
		styleVariant,
		theme,
		setTheme,
		onLoginModalOpen,
	};

	return (
		<>
		<header
			className={twMerge(
				"w-full max-w-[96rem] px-0 xl:px-14 sticky top-0 xl:relative z-50 pt-0 print:hidden transition-[transform,border-radius] origin-top",
				styleVariant === "wide" && "bg-white dark:bg-secondary max-w-none",
				isMapPage &&
					(styleVariant !== "wide"
						? "xl:absolute xl:top-6 xl:scale-75"
						: "xl:absolute xl:scale-75 xl:rounded-b-2xl")
			)}
		>
			<div
				className={twMerge(
					"xl:h-[6.5rem] h-20 bg-white dark:bg-secondary xl:rounded-2xl flex items-center p-4 py-6 xl:p-8 gap-6 z-10",
					styleVariant === "wide" &&
						"bg-transparent max-w-[96rem] mx-auto xl:px-14",
					// When the search bar is docked beneath the navbar (non-wide
					// style), square the bottom so the two read as one unit.
					styleVariant !== "wide" &&
						showNavbarSearch &&
						"xl:rounded-b-none"
				)}
			>
				<Logo />

				{/* Desktop navigation links (xl+) */}
				<nav aria-label={t("mainNavAriaLabel")} className="flex-1">
					<NavLinks pathname={pathname} styleVariant={styleVariant} />
				</nav>

				{/* Mobile inline actions (< xl) - Login button/Avatar stay visible */}
				{mobileInlineElements.length > 0 && (
					<div className="flex xl:hidden items-center gap-3">
						{mobileInlineElements.map((element) => {
							const Component = element.component;
							return (
								<Component
									key={element.id}
									variant="inline"
									styleVariant={styleVariant}
									onAction={
										element.id === "login-button" ? onLoginModalOpen : undefined
									}
								/>
							);
						})}
					</div>
				)}

				{/* Tablet condensed dropdown (xl to 2xl) */}
				{tabletDropdownElements.length > 0 && (
					<div className="hidden xl:block 2xl:hidden">
						<ActionsDropdown context={navbarContext} />
					</div>
				)}

				{/* Desktop expanded actions (2xl+) */}
				{desktopInlineElements.length > 0 && (
					<nav
						className="hidden 2xl:block"
						aria-label={t("secondaryNavAriaLabel")}
					>
						<ul className="flex items-center gap-3">
							{desktopInlineElements.map((element) => {
								const Component = element.component;
								return (
									<li key={element.id}>
										<Component
											variant="inline"
											styleVariant={styleVariant}
											onAction={
												element.id === "login-button"
													? onLoginModalOpen
													: undefined
											}
										/>
									</li>
								);
							})}
						</ul>
					</nav>
				)}

				{/* Mobile hamburger menu (< xl) */}
				<MobileMenu
					elements={mobileMenuElements}
					context={navbarContext}
					pathname={pathname}
				/>

				{/* Login modal */}
				<LoginModal
					isOpen={isLoginModalOpen}
					onOpenChange={onLoginModalOpenChange}
					onClose={onLoginModalClose}
				/>
			</div>
		</header>

		{/* Secondary search bar — rendered on the page background (outside the
		    navbar container) so it reads as a separate panel rather than sharing
		    the navbar's surface, especially in the wide style variant where the
		    header itself is a full-bleed colored band. Aligned to the navbar's
		    content width. */}
		{showNavbarSearch && (
			<div className="w-full max-w-[96rem] px-0 xl:px-14">
				<NavbarSearch />
			</div>
		)}
		</>
	);
}

// Re-export Logo for external use
export { Logo } from "./Logo";
