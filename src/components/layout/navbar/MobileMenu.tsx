"use client";

import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";
import NavLinks, { useNavigationLinks } from "./NavLinks";
import { useHydrated } from "@/hooks/useHydrated";
import type { NavbarElementConfig, NavbarContext } from "@/types/navbar";

interface MobileMenuProps {
	elements: NavbarElementConfig[];
	context: NavbarContext;
	pathname: string;
}

function MenuIcon({isOpen}: {isOpen: boolean}) {
	const reducedMotion = useReducedMotion();
	return <AnimatePresence mode="wait" initial={false}>
		<motion.span key={isOpen ? "close" : "menu"} initial={{opacity: 0, scale: 0.8}} animate={{opacity: 1, scale: 1}} exit={{opacity: 0, scale: 0.8}} transition={{duration: reducedMotion ? 0 : 0.15}} className="inline-flex size-8">
			<HugeiconsIcon icon={isOpen ? Cancel01Icon : Menu01Icon} className="size-8 text-accent cursor-pointer transition-transform active:scale-80 delay-0" />
		</motion.span>
	</AnimatePresence>;
}

export default function MobileMenu({
	elements,
	context,
	pathname,
}: MobileMenuProps) {
	const { hasLinks } = useNavigationLinks();
	const [isOpen, setIsOpen] = useState(false);
	const hydrated = useHydrated();
	const menuId = useId();
	const triggerRef = useRef<HTMLDivElement>(null);
	const t = useTranslations("ui");

	const toggleMenu = () => setIsOpen(!isOpen);
	function closeMenu() {
		setIsOpen(false);
		triggerRef.current?.querySelector("button")?.focus();
	}
	function closeOnEscape(event: KeyboardEvent) {
		if (event.key !== "Escape" || event.defaultPrevented) return;
		event.preventDefault();
		closeMenu();
	}

	if (!hasLinks && elements.length === 0) return null;

	return (
		<>
			{/* Hamburger/Close button - only visible on mobile */}
			<div ref={triggerRef} className="xl:hidden ml-auto rtl:ml-0 rtl:mr-auto flex justify-center items-center">
				{/* Not pressable until the page is ready, by style rather than the `disabled` attribute: Firefox restores that
				    attribute from the last visit on reload, before the page is ready, and hydration then fails. */}
				<Button variant="invisible" aria-disabled={!hydrated || undefined} className={hydrated ? undefined : "pointer-events-none opacity-disabled"} aria-label={t(isOpen ? "close" : "openMenuAriaLabel")} aria-expanded={isOpen} aria-controls={menuId} onPress={toggleMenu} onKeyDown={closeOnEscape}>
					<MenuIcon isOpen={isOpen} />
				</Button>
			</div>

			{/* Mobile menu dropdown */}
			<ul
				id={menuId}
				inert={!isOpen}
				aria-hidden={!isOpen}
				onKeyDown={closeOnEscape}
				className={twMerge(
					"xl:hidden bg-[#EAE9E5] dark:bg-secondary-400 rounded-2xl rounded-t-none relative duration-300 motion-reduce:duration-0 overflow-y-auto overscroll-contain -z-10 flex flex-col gap-8",
					// Position absolutely when open to overlay content
					"absolute left-0 right-0 top-full",
					isOpen
						? "max-h-[calc(100dvh-104px)] py-8 mb-4 opacity-100 shadow-xl shadow-[#EAE9E5] dark:shadow-secondary-400"
						: "max-h-0 opacity-0"
				)}
			>
				{/* Navigation links */}
				{hasLinks && <li>
					<NavLinks
						pathname={pathname}
						isMobile={true}
						styleVariant={context.styleVariant}
						onNavigate={closeMenu}
					/>
				</li>}

				{/* Render enabled elements as menu items */}
				{elements
					.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
					.map((element) => {
						const Component = element.component;
						return (
							<li
								key={element.id}
								className="w-full justify-center flex items-center"
							>
								<Component
									variant="inline"
									styleVariant={context.styleVariant}
									showLabel={true}
									onAction={
										element.id === "login-button"
											? context.onLoginModalOpen
											: undefined
									}
								/>
							</li>
						);
					})}
			</ul>
		</>
	);
}
