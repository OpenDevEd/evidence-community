"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { GiHamburgerMenu } from "react-icons/gi";
import { IoCloseSharp } from "react-icons/io5";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";
import NavLinks from "./NavLinks";
import type { NavbarElementConfig, NavbarContext } from "@/types/navbar";

interface MobileMenuProps {
	elements: NavbarElementConfig[];
	context: NavbarContext;
	pathname: string;
}

export default function MobileMenu({
	elements,
	context,
	pathname,
}: MobileMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	const t = useTranslations("ui");

	const toggleMenu = () => setIsOpen(!isOpen);

	return (
		<>
			{/* Hamburger/Close button - only visible on mobile */}
			<AnimatePresence mode="wait">
				{(isOpen ? [IoCloseSharp] : [GiHamburgerMenu]).map((Icon) => (
					<motion.div
						key={isOpen ? "close" : "menu"}
						initial={{ opacity: 0, scale: 0.8 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.8 }}
						transition={{ duration: 0.15 }}
						className="xl:hidden ml-auto rtl:ml-0 rtl:mr-auto flex justify-center items-center"
					>
						<Button
							variant="invisible"
							aria-label={t("openMenuAriaLabel")}
							onPress={toggleMenu}
						>
							<Icon className="size-8 !fill-accent !stroke-accent cursor-pointer transition-transform active:scale-80 delay-0" />
						</Button>
					</motion.div>
				))}
			</AnimatePresence>

			{/* Mobile menu dropdown */}
			<ul
				className={twMerge(
					"xl:hidden bg-[#EAE9E5] dark:bg-secondary-400 rounded-2xl rounded-t-none relative duration-300 overflow-y-hidden -z-10 flex flex-col gap-8",
					// Position absolutely when open to overlay content
					"absolute left-0 right-0 top-full",
					isOpen
						? "max-h-[calc(100vh-104px)] py-8 mb-4 opacity-100 shadow-xl shadow-[#EAE9E5] dark:shadow-secondary-400"
						: "max-h-0 opacity-0"
				)}
			>
				{/* Navigation links */}
				<li>
					<NavLinks
						pathname={pathname}
						isMobile={true}
						styleVariant={context.styleVariant}
					/>
				</li>

				{/* Render enabled elements as menu items */}
				{elements
					.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
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
