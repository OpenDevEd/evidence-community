"use client";

import Link from "next/link";
import Image from "next/image";
import { localesNames, routing, usePathname, useRouter } from "@/i18n/routing";
import { twMerge } from "tailwind-merge";
import { links } from "@/constants/links";
import Dark from "@/components/icons/Dark";
import { useTheme } from "next-themes";
import { HiOutlineMoon, HiOutlineSun } from "react-icons/hi2";
import { IoMdClose, IoMdSunny } from "react-icons/io";
import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { RxHamburgerMenu } from "react-icons/rx";
import { GiHamburgerMenu } from "react-icons/gi";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import { IoCloseSharp } from "react-icons/io5";
import config from "@/constants/config.json";
import { style } from "@/../tailwind.config";
import type { LinkObject } from "@/constants/links";
import {
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
	Select,
	SelectItem,
	useDisclosure,
} from "@nextui-org/react";
import { ChevronDownIcon } from "@nextui-org/shared-icons";
import { useDebounce } from "@/hooks/useDebounce";
import { useLocale, useTranslations } from "next-intl";
import { Dropdown } from "@/components/nextui/Dropdown";

function ThemeSwitcher({
	theme,
	setTheme,
	isMounted,
	isMobile = false,
}: {
	theme: string | undefined;
	setTheme: (theme: string) => void;
	isMounted: boolean;
	isMobile?: boolean;
}) {
	return (
		<Skeleton
			isLoaded={isMounted}
			className={twMerge(
				"h-6 w-6 rounded-lg",
				isMobile ? "xl:hidden block w-full" : "xl:block hidden"
			)}
			onClick={() => {
				setTheme(theme === "dark" ? "light" : "dark");
			}}
		>
			<div className="flex items-center justify-center gap-2">
				{[IoMdSunny, HiOutlineMoon].map(
					(Icon, index) =>
						isMounted && (
							<Icon
								key={index}
								className={twMerge(
									"size-5 xl:size-6 cursor-pointer select-none active:scale-95 transition-all",
									theme === "dark"
										? "stroke-accent"
										: "fill-accent",
									theme === "dark" && index === 0 && "hidden",
									theme === "light" && index === 1 && "hidden"
								)}
							/>
						)
				)}
				{isMobile && isMounted && (
					<span className="text-sm text-accent">
						Switch to {theme === "dark" ? "Light" : "Dark"} mode
					</span>
				)}
			</div>
		</Skeleton>
	);
}

function Logo({
	theme,
	isMounted,
}: {
	theme: string | undefined;
	isMounted: boolean;
}) {
	return (
		<Skeleton
			isLoaded={isMounted}
			className="w-[171px] h-[40px] rounded-lg"
		>
			{isMounted && (
				<Image
					src={
						theme === "dark"
							? `/logos/${style}/logo.png`
							: `/logos/${style}/logo_light.png`
					}
					alt="logo"
					height={40}
					width={171}
				/>
			)}
		</Skeleton>
	);
}

function LinkItem({ link, pathname }: { link: LinkObject; pathname: string }) {
	const t = useTranslations("nav");
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const [debouncedOnClose, timeoutRef] = useDebounce(onClose, 250);

	const clearTimeoutOpen = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}
		onOpen();
	}, [timeoutRef, onOpen]);

	return (
		<div
			onMouseEnter={clearTimeoutOpen}
			onMouseLeave={debouncedOnClose}
			className={twMerge(
				"flex items-center gap-2 text-black/60 dark:text-white/60",
				(pathname + "/").includes(link.href + "/") &&
					"text-accent dark:text-accent"
			)}
		>
			<Link
				href={link.href}
				key={link.label}
				className={twMerge(
					"flex  gap-2 text-lg items-center justify-center font-medium",
					style === "edtechhub" && "uppercase font-base"
				)}
			>
				{link.icon && (
					<link.icon
						className={twMerge(
							"fill-current size-6 shrink-0",
							style === "edtechhub" && "size-5"
						)}
					/>
				)}
				<span className="line-clamp-1">{t(link.label)}</span>
			</Link>
			{link.dropdown && (
				<Dropdown
					color="accent"
					isOpen={isOpen}
					onOpenChange={onOpenChange}
					offset={12}
				>
					<DropdownTrigger>
						<div className="relative">
							<ChevronDownIcon className="size-4" />
						</div>
					</DropdownTrigger>
					<DropdownMenu
						itemClasses={{
							base: "data-[hover]:bg-accent-400 ",
							title: "text-white",
						}}
					>
						{link.dropdown?.map((child) => (
							<DropdownItem key={child.label} href={child.href}>
								{t(child.label)}
							</DropdownItem>
						))}
					</DropdownMenu>
				</Dropdown>
			)}
		</div>
	);
}

function LinksList({
	pathname,
	isMobile = false,
}: {
	pathname: string;
	isMobile?: boolean;
}) {
	return (
		<div
			className={twMerge(
				"flex flex-1 items-center justify-end gap-8",
				style === "edtechhub" && "gap-6",
				isMobile && "flex-col gap-8",
				!isMobile && "hidden xl:flex"
			)}
		>
			{links[style as keyof typeof links].map(
				(link, index) =>
					!link.navExclude && (
						<LinkItem link={link} pathname={pathname} key={index} />
					)
			)}
		</div>
	);
}

function LanguageSwitcher() {
	const router = useRouter();
	const locale = useLocale();
	const pathname = usePathname();

	return (
		<Dropdown>
			<DropdownTrigger className="cursor-pointer select-none">
				<div className="relative flex items-center gap-2 uppercase">
					<span className="text-lg font-medium">
						{localesNames[locale as keyof typeof localesNames]}
					</span>
					<ChevronDownIcon className="size-4" />
				</div>
			</DropdownTrigger>
			<DropdownMenu
				onAction={(locale) => {
					router.push(pathname, { locale: locale as string });
				}}
			>
				{routing.locales.filter(currentLocale => currentLocale !== locale).map((locale) => (
					<DropdownItem key={locale}>
						{localesNames[locale as keyof typeof localesNames]}
					</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	);
}

export default function Navbar() {
	const pathname = usePathname();
	const [isMounted, setIsMounted] = useState(false);
	const { theme, setTheme } = useTheme();
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

	useEffect(() => {
		setIsMounted(true);
	}, []);

	return (
		<nav
			className={twMerge(
				"w-full max-w-screen-2xl px-0 xl:px-14 sticky top-0 xl:relative z-50 pt-0",
				style === "edtechhub" && "bg-white dark:bg-secondary max-w-none"
			)}
		>
			<div
				className={twMerge(
					"h-18 xl:h-[104px] bg-white dark:bg-secondary xl:rounded-[20px] flex items-center p-4 py-6 xl:p-8 gap-9 z-10",
					style === "edtechhub" &&
						"bg-transparent max-w-screen-2xl mx-auto xl:px-14"
				)}
			>
				<Logo theme={theme} isMounted={isMounted} />
				<LinksList pathname={pathname} />
				<LanguageSwitcher />
				<ThemeSwitcher
					theme={theme}
					setTheme={setTheme}
					isMounted={isMounted}
				/>
				<AnimatePresence mode="wait">
					{(isMobileMenuOpen
						? [IoCloseSharp]
						: [GiHamburgerMenu]
					).map((Icon) => (
						<motion.div
							key={isMobileMenuOpen ? "close" : "menu"}
							initial={{ opacity: 0, scale: 0.8 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.8 }}
							transition={{ duration: 0.15 }}
							className="xl:hidden block ml-auto rtl:ml-0 rtl:mr-auto"
						>
							<Icon
								className="size-8 !fill-accent !stroke-accent cursor-pointer transition-transform active:scale-80 delay-0"
								onClick={() =>
									setIsMobileMenuOpen(!isMobileMenuOpen)
								}
							/>
						</motion.div>
					))}
				</AnimatePresence>
			</div>
			<div
				className={twMerge(
					"xl:hidden bg-[#EAE9E5] dark:bg-secondary-400 rounded-[20px] rounded-t-none relative duration-300 overflow-y-hidden -z-10 flex flex-col gap-8",
					isMobileMenuOpen
						? "max-h-[calc(100vh-104px)] py-8 mb-4 opacity-100 shadow-xl shadow-[#EAE9E5] dark:shadow-secondary-400"
						: "max-h-0 opacity-0"
				)}
			>
				<LinksList pathname={pathname} isMobile={true} />
				<ThemeSwitcher
					theme={theme}
					setTheme={setTheme}
					isMounted={isMounted}
					isMobile={true}
				/>
			</div>
		</nav>
	);
}
