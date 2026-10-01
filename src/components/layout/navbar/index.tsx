"use client";

import { useTranslations } from "next-intl";
import { useMockReaderSession } from "./MockReaderSession";
import { useTheme } from "next-themes";
import { useDisclosure } from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";
import { usePathname } from "@/i18n/routing";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

import { Logo } from "./Logo";
import NavLinks from "./NavLinks";
import NavbarSearch from "./NavbarSearch";
import MobileMenu from "./MobileMenu";
import ActionsDropdown from "./ActionsDropdown";

import {
	navbarElements,
	getEnabledElements,
	getElementsByPlacement,
} from "@/config/navbar.config";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { normalizePathname } from "@/lib/path";
import { pageRunsUnderHeader } from "@/lib/runtime-routing";

import type {
	NavbarContext as NavbarContextType,
	NavbarStyleVariant,
} from "@/types/navbar";

/** The bar's surface in each style. */
const BAR_STYLE: Record<NavbarStyleVariant, string> = {
	small: "",
	wide: "bg-transparent max-w-site mx-auto xl:px-14",
};

/**
 * The bar while the chat is open beside the results. Only where the split
 * view exists: on a phone the chat sits above the results and the header
 * keeps its size. The small style shrinks by scaling the whole header; the
 * wide band must stay full width, so its bar loses height instead, down to
 * the same three quarters.
 */
const BAR_BESIDE_CHAT: Record<NavbarStyleVariant, string> = {
	small: "lg:h-14 lg:py-2",
	wide: "lg:h-14 lg:py-2 xl:h-navbar-split xl:py-4",
};

/** The bar inside the header: its size, surface and corners. */
function barClassName(
	styleVariant: NavbarStyleVariant,
	chatEngaged: boolean,
	showNavbarSearch: boolean,
) {
	return twMerge(
		"navbar-bar xl:h-navbar h-20 bg-white dark:bg-secondary xl:rounded-2xl flex items-center p-4 py-6 xl:p-8 gap-6 z-10 transition-header duration-split ease-split motion-reduce:transition-none",
		BAR_STYLE[styleVariant],
		chatEngaged && BAR_BESIDE_CHAT[styleVariant],
		// When the search bar is docked beneath the navbar (non-wide
		// style), square the bottom so the two read as one unit.
		styleVariant !== "wide" && showNavbarSearch && "xl:rounded-b-none",
	);
}

export default function Navbar() {
	const t = useTranslations("ui");
	const pathname = usePathname();
	const { resolvedTheme: theme, setTheme } = useTheme();
	const { reader: session } = useMockReaderSession();
	const libraryConfig = useLibraryConfig();
	const isLoginEnabled = isLibraryFeatureEnabled(
		libraryConfig.features,
		"login",
	);
	const styleVariant =
		libraryConfig.theme.layout as NavbarStyleVariant;

	const {
		isOpen: isLoginModalOpen,
		onOpen: onLoginModalOpen,
		onOpenChange: onLoginModalOpenChange,
		onClose: onLoginModalClose,
	} = useDisclosure();

	const { engaged: chatEngaged } = useInlineChatLayout();
	const normalizedPathname = normalizePathname(pathname);
	const floatsOverPage = pageRunsUnderHeader(pathname);

	// The navbar search routes to the library listing, so hide it on pages that
	// already own a search bar (the listing, the map, and a user's profile).
	// It also stays in the page flow, so it cannot follow a header that floats
	// over the page (the home page): there it would sit under the header.
	const isSearchOwningPath =
		normalizedPathname === "/lib" ||
		normalizedPathname.startsWith("/map") ||
		normalizedPathname.startsWith("/profile");
	const showNavbarSearch =
		isLibraryFeatureEnabled(
			libraryConfig.features,
			"navbarSearch",
		) &&
		!isSearchOwningPath &&
		!floatsOverPage;

	// Get enabled elements based on runtime configuration and session.
	const enabledElements = getEnabledElements(
		libraryConfig.features,
		session,
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
		session,
		styleVariant,
		theme,
		setTheme,
		onLoginModalOpen,
	};

	return (
		<>
		<header
			id="site-header"
			className={twMerge(
				"w-full px-0 sticky top-0 xl:relative z-50 pt-0 print:hidden transition-chrome duration-split ease-split origin-top motion-reduce:transition-none",
				styleVariant === "wide"
					? "bg-white dark:bg-secondary"
					: "max-w-site xl:px-14",
				floatsOverPage &&
					(styleVariant !== "wide"
						? "xl:absolute xl:top-6 xl:scale-75"
						: "xl:absolute"),
				// The small style floats the header below the top of the
				// page; while the chat is open it sticks at the same offset,
				// so the header and the chat do not jump apart on scroll.
				chatEngaged &&
					!floatsOverPage &&
					(styleVariant !== "wide"
						? "xl:sticky xl:top-split xl:scale-75"
						: "xl:sticky xl:top-0")
			)}
		>
			<div
				className={barClassName(
					styleVariant,
					chatEngaged,
					showNavbarSearch,
				)}
			>
				<Logo />

				{/* Desktop navigation links (xl+) */}
				<nav
					aria-label={t("mainNavAriaLabel")}
					className="min-w-0 flex-1"
				>
					<NavLinks pathname={pathname} styleVariant={styleVariant} />
				</nav>

				{/* Mobile inline actions (< xl) - Login button/Avatar stay visible */}
				{mobileInlineElements.length > 0 && (
					<div className="nf-compact flex items-center gap-3">
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
					<div className="nf-actions-condensed">
						<ActionsDropdown context={navbarContext} />
					</div>
				)}

				{/* Desktop expanded actions (2xl+) */}
				{desktopInlineElements.length > 0 && (
					<nav
						className="nf-actions-full"
						aria-label={t("secondaryNavAriaLabel")}
					>
						<ul className="flex items-center gap-6">
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
					key={pathname}
					elements={mobileMenuElements}
					context={navbarContext}
					pathname={pathname}
				/>

			</div>
		</header>

		{/* Secondary search bar — rendered on the page background (outside the
		    navbar container) so it reads as a separate panel rather than sharing
		    the navbar's surface, especially in the wide style variant where the
		    header itself is a full-bleed colored band. Aligned to the navbar's
		    content width. */}
		{showNavbarSearch && (
			<div className="relative z-40 w-full max-w-site px-0 xl:px-14">
				<NavbarSearch />
			</div>
		)}
		</>
	);
}

// Re-export Logo for external use
export { Logo } from "./Logo";
