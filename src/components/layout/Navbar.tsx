"use client";

import Image from "next/image";
import {
	localesNames,
	routing,
	shortLocalesNames,
	usePathname,
	useRouter,
} from "@/i18n/routing";
import { twMerge } from "tailwind-merge";
import { links, NAVBAR_ICONS } from "@/constants/links";
import { useTheme } from "next-themes";
import { HiOutlineMoon } from "react-icons/hi2";
import { IoIosLogIn, IoMdSunny } from "react-icons/io";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { GiHamburgerMenu } from "react-icons/gi";
import { animate, AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import { IoCloseSharp } from "react-icons/io5";
import { style } from "@/../tailwind.config";
import {
	Avatar,
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
	ModalContent,
	Modal,
	ModalHeader,
	useDisclosure,
	ModalBody,
} from "@heroui/react";
import { ChevronDownIcon } from "@heroui/shared-icons";
import { useDebounce } from "@/hooks/useDebounce";
import { useLocale, useTranslations } from "next-intl";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Link } from "@/i18n/routing";
import { Button } from "../nextui/Button";
import { BiError, BiErrorCircle, BiLogIn, BiLogOut } from "react-icons/bi";
import { signIn, signOut, useSession } from "next-auth/react";
import { Input } from "../nextui/Input";
import FullScreenModal from "../nextui/FullScreenModal";
import GenericHeader from "../features/modals/GenericHeader";
import { FaGoogle, FaEnvelope, FaLock } from "react-icons/fa";
import { authenticate } from "@/lib/auth";
import { Router } from "next/router";
import { useModalError } from "@/hooks/useModalError";
import { useFeatureFlagEnabled, useStatus } from "@/context/Providers";
import { LinkObject } from "@/db/schema/tables/status";
import DialogModal from "../nextui/DialogModal";
import { convertStringFromDatabaseToObject, getDynamicStyles } from "@/lib/utils";

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
	const isThemeSwitcherEnabled = useFeatureFlagEnabled("theme-switcher");
	const t = useTranslations("ui");

	return (
		isThemeSwitcherEnabled && (
		<li
			className={twMerge(
				"size-6 rounded-lg",
				isMobile ? "xl:hidden w-full justify-center flex items-center" : "xl:block hidden"
			)}
		>
			<Button
				suppressHydrationWarning
				className="flex items-center justify-center gap-2"
				variant="invisible"
				disableRipple
				onPress={() => {
					setTheme(theme === "dark" ? "light" : "dark");
				}}
				aria-label={t("switchThemeAriaLabel", {
					theme: theme === "dark" ? t("lightTheme") : t("darkTheme")
				})}
			>
				{[IoMdSunny, HiOutlineMoon].map((Icon, index) => (
					<Icon
						suppressHydrationWarning
						key={index}
						aria-hidden={
							["dark", "light"].indexOf(theme ?? "light") !==
							index
						}
						className={twMerge(
							"size-5 xl:size-6 cursor-pointer select-none active:scale-95 transition-all",
							"dark:stroke-accent fill-accent dark:fill-none",
							index === 0 && "dark:hidden",
							index === 1 && "hidden dark:block"
						)}
					/>
				))}
				{isMobile && (
					<span className={twMerge("text-lg text-accent", style === "wide" ? "uppercase" : "")}>
						{["dark", "light"].map((themeToMatch) => (
							<span
								suppressHydrationWarning
								key={themeToMatch}
								aria-hidden={themeToMatch !== theme}
								className={twMerge(
									themeToMatch === "dark"
										? "dark:hidden"
										: "hidden dark:block"
								)}
							>
								{`Switch to ${themeToMatch} mode`}
							</span>
						))}
					</span>
				)}
			</Button>
			</li>
		)
	);
}

export function Logo({ interactive = true, dbStyle = "navbar" }: { interactive?: boolean, dbStyle?: string }) {
	const [isLoaded, setIsLoaded] = useState(false);
	const status = useStatus();
	const { theme } = useTheme();
	const t = useTranslations("ui");
	const companyLogoStyle = status.companyLogo || "";
	
	const navbarStyle = dbStyle ? convertStringFromDatabaseToObject(companyLogoStyle)[dbStyle] : "";
	
	const logoContent = (
		<div
			className={twMerge(
				"transition-all select-none",
				interactive &&
					"cursor-pointer hover:brightness-90 hover:scale-95 active:scale-105 "
			)}
		>
			{["dark", "light"].map((themeToMatch) => (
				<Image
					data-component="navbar"
					suppressHydrationWarning
					key={themeToMatch}
					aria-hidden={themeToMatch !== theme}
					onLoad={() => setIsLoaded(true)}
					src={
						themeToMatch === "dark"
							? `/logos/${status?.companyName?.toLowerCase()}/logo.png`
							: `/logos/${status?.companyName?.toLowerCase()}/logo_light.png`
					}
					className={twMerge(
						"pointer-events-none",
						themeToMatch === "light"
							? "dark:hidden"
							: "hidden dark:block"
					)}
					alt={t("logoAlt", { 
						company: status?.companyName,
						theme: themeToMatch 
					})}
					style={{ ...getDynamicStyles(navbarStyle) }}
					height={40}
					width={171}
				/>
			))}
		</div>
	);

	return (
		<Skeleton
			isLoaded={true}
			className="w-[10.6875rem] h-[2.5rem] rounded-lg flex justify-center items-center"
		>
			{interactive ? (
				<Link
					href={
						links[style as keyof typeof links].find(
							(link) => link.label === "home"
						)?.href ?? "/"
					}
				>
					{logoContent}
				</Link>
			) : (
				logoContent
			)}
		</Skeleton>
	);
}

function LinkItem({ link, pathname, isMobile }: { link: LinkObject; pathname: string; isMobile: boolean }) {
	const t = useTranslations("nav");
	const tUI = useTranslations("ui");
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const [debouncedOnClose, timeoutRef] = useDebounce(onClose, 250);

	const clearTimeoutOpen = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}
		onOpen();
	}, [timeoutRef, onOpen]);

	return (
		<li
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
				data-is-mobile={isMobile}
				className={twMerge(
					"flex gap-2 text-sm 2xl:text-lg data-[is-mobile=true]:text-lg items-center justify-center font-medium",
					style === "wide" && "uppercase font-base"
				)}
			>
				{link.icon &&
					Object.entries(NAVBAR_ICONS)
						.filter(([key]) => key === link.icon)
						.map(([key, Value]) => (
							<Value
								key={key}
								data-is-mobile={isMobile}
								aria-label={tUI("dropdownAriaLabel", {
									label: t(link.label)
								})}
								className={twMerge(
									"fill-current size-4 2xl:size-6 data-[is-mobile=true]:size-6 shrink-0",
									style === "wide" && "size-4 2xl:size-5 data-[is-mobile=true]:size-5"
								)}
							/>
						))}
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
						<Button
							variant="invisible"
							className="relative text-current dark:text-current"
							aria-label={tUI("dropdownAriaLabel", {
								label: link.label
							})}
						>
							<ChevronDownIcon className="size-4" />
						</Button>
					</DropdownTrigger>
					<DropdownMenu
						itemClasses={{
							base: "data-[hover]:bg-accent-400 ",
							title: "text-white",
						}}
					>
						{link.dropdown?.map((child: any) => (
							<DropdownItem key={child.label} href={child.href}>
								{t(child.label)}
							</DropdownItem>
						))}
					</DropdownMenu>
				</Dropdown>
			)}
		</li>
	);
}

function LinksList({
	pathname,
	isMobile = false,
}: {
	pathname: string;
	isMobile?: boolean;
}) {
	const status = useStatus();

	const links: LinkObject[] = status.links || [];

	return (
		<ul
			className={twMerge(
				"flex items-center justify-end gap-6",
				isMobile && "flex-col gap-8 px-8",
				!isMobile && "hidden xl:flex",
			)}
		>
			{links.map(
				(link, index) =>
					!link.navExclude && (
						<LinkItem link={link} pathname={pathname} key={index} isMobile={isMobile} />
					)
			)}
		</ul>
	);
}

function LanguageSwitcher({ className, isMobile = false }: { className?: string; isMobile?: boolean }) {
	const isLanguageSwitcherEnabled = useFeatureFlagEnabled("language-switcher");
	const router = useRouter();
	const locale = useLocale();
	const pathname = usePathname();
	const localesPriority = process.env.NEXT_PUBLIC_LOCALES_PRIORITY?.split(",") || [];
	const localesList = routing.locales.filter((currentLocale) => currentLocale !== locale)
		.sort((a, b) => {
			const aIndex = localesPriority.indexOf(a);
			const bIndex = localesPriority.indexOf(b);
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			return aIndex - bIndex;
		});

	return (
		isLanguageSwitcherEnabled && (
		<li
			data-style={style}
			className="relative flex justify-center items-center gap-2 data-[style=wide]:uppercase"
		>
			<Dropdown>
				<DropdownTrigger
					className={twMerge("cursor-pointer select-none", className)}
				>
					<Button
						variant="invisible"
						tabIndex={0}
						disableRipple
						className="flex items-center gap-2 !px-2 justify-center"
					>
						<div data-is-mobile={isMobile} className="text-sm 2xl:text-lg data-[is-mobile=true]:text-lg font-medium">
							{
								shortLocalesNames[
									locale as keyof typeof shortLocalesNames
								]
							}
						</div>
						<ChevronDownIcon className="size-4" />
					</Button>
				</DropdownTrigger>
				<DropdownMenu
					onAction={(locale) => {
						router.push(pathname, { locale: locale as string });
					}}
				>
					{localesList.map((locale) => (
						<DropdownItem key={locale}>
								{
									localesNames[
										locale as keyof typeof localesNames
									]
								}
							</DropdownItem>
						))}
					</DropdownMenu>
				</Dropdown>
			</li>
		)
	);
}

function UserButton() {
	const { data: session } = useSession();
	const router = useRouter();
	const t = useTranslations("ui");

	return (
		<Dropdown>
			<DropdownTrigger>
				<Avatar
					src={session?.user?.image ?? `/icons/profile.png` ?? ""}
					alt={t("userAvatarAlt", { 
						name: session?.user?.name || session?.user?.email || t("genericUser")
					})}
				/>
			</DropdownTrigger>
			<DropdownMenu
				onAction={(key) => {
					if (key === "logout") {
						signOut({
							redirect: false,
						});
					} else if (key === "profile") {
						router.push(`/profile/${session?.user?.id}`);
					}
				}}
			>
				<DropdownItem key="profile">{t("profileMenuItem")}</DropdownItem>
				<DropdownItem key="settings">{t("settingsMenuItem")}</DropdownItem>
				<DropdownItem key="logout" color="danger">
					{t("logout")}
				</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	);
}

function LoginModal({
	isOpen,
	onOpenChange,
	onClose,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onClose: () => void;
}) {
	const t = useTranslations("ui");
	const tAuth = useTranslations("auth");
	const [loading, setLoading] = useState(false);
	const {
		displayOnError,
		errorClassName,
		ErrorField,
		containerRef,
		errorMessage,
	} = useModalError({
		initial: {
			height: 0,
			opacity: 0,
			y: 8,
		},
		animate: { height: "auto", opacity: 1 },
		exit: { height: 0, opacity: 0, y: 0 },
	});

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setLoading(true);
		try {
			const formData = new FormData(e.target as HTMLFormElement);
			const email = formData.get("email") as string;
			const password = formData.get("password") as string;
			const submitButton = document.activeElement as HTMLButtonElement;
			const isRegister = submitButton.hasAttribute("data-register");

			const result = await authenticate({
				email,
				password,
				register: isRegister,
			});

			const errors = (
				result?.error
					? result.error
							.split(", ")
							.map((error: string) => tAuth(error))
					: []
			).join("\n");

			if (!displayOnError(errors)) {
				onClose();
			}
		} catch (error: any) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	return (
		<DialogModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent className={errorClassName}>
				<GenericHeader onClose={onClose}>
					<div className="scale-75 origin-bottom-left">
						
					<Logo interactive={false} />
					</div>
				</GenericHeader>
				<ModalBody>
					<div
						ref={containerRef}
						className="flex flex-col gap-2 pb-4"
					>
						<div>
							<form
								onSubmit={handleSubmit}
								className="flex flex-col gap-2"
							>
								<Input
									startContent={
										<FaEnvelope 
											aria-hidden="true" 
											className="size-5 ltr:mr-1 rtl:ml-1 fill-black dark:fill-white/40" 
										/>
									}
									name="email"
									placeholder="Email"
								/>
								<Input
									startContent={
										<FaLock 
											aria-hidden="true" 
											className="size-5 ltr:mr-1 rtl:ml-1 fill-black dark:fill-white/40" 
										/>
									}
									type="password"
									name="password"
									placeholder="Password"
								/>
								<div className="flex items-center gap-2 h-10">
									<Button
										isDisabled={loading}
										color="accent"
										className="w-full h-full"
										type="submit"
									>
										{t("login")}
									</Button>
									<Button
										isDisabled={loading}
										color="secondary"
										className="w-full h-full"
										data-register
										type="submit"
									>
										{t("register")}
									</Button>
								</div>
							</form>
							<AnimatePresence mode="sync">
								{errorMessage && <ErrorField />}
							</AnimatePresence>
						</div>
						<div className="flex items-center gap-4 my-4">
							<div className="flex-1 h-[0.0625rem] bg-black/10 dark:bg-white/10" />
							<span className="text-black/60 dark:text-white/60">
								{t("or")}
							</span>
							<div className="flex-1 h-[0.0625rem] bg-black/10 dark:bg-white/10" />
						</div>
						<Button
							onPress={() => signIn("google")}
							color="secondary"
							className="w-full dark:bg-white dark:text-black"
							startContent={<FaGoogle className="size-5" />}
						>
							{t("continueWithGoogle")}
						</Button>
					</div>
				</ModalBody>
			</ModalContent>
		</DialogModal>
	);
}

export default function Navbar() {
	const t = useTranslations("ui");
	const pathname = usePathname();
	const [isMounted, setIsMounted] = useState(false);
	const { theme, setTheme } = useTheme();
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const { data: session } = useSession();
	const isLoginEnabled = useFeatureFlagEnabled("login");
	const {
		isOpen: isLoginModalOpen,
		onOpen: onLoginModalOpen,
		onOpenChange: onLoginModalOpenChange,
		onClose: onLoginModalClose,
	} = useDisclosure();
	const isMapPage = pathname.includes("/map");
	useEffect(() => {
		setIsMounted(true);
	}, []);

	return (
		<header
			className={twMerge(
				"w-full max-w-[96rem] px-0 xl:px-14 sticky top-0 xl:relative z-50 pt-0 print:hidden transition-[transform,border-radius] origin-top",
				style === "wide" && "bg-white dark:bg-secondary max-w-none",
				(isMapPage) && (style !== "wide" ? "xl:absolute xl:top-6 xl:scale-75" : "xl:absolute xl:scale-75 xl:rounded-b-2xl"),
			)}
		>
	
			<div
				className={twMerge(
					"xl:h-[6.5rem] h-20 bg-white dark:bg-secondary xl:rounded-2xl flex items-center p-4 py-6 xl:p-8 gap-3 2xl:gap-6 z-10",
					style === "wide" &&
						"bg-transparent max-w-[96rem] mx-auto xl:px-14"
				)}
			>
				<Logo />
				<nav aria-label={t("mainNavAriaLabel")} className="flex-1">
					<LinksList pathname={pathname} />
				</nav>
				<nav className="[&:has(>ul:empty)]:hidden" aria-label={t("secondaryNavAriaLabel")}>
					<ul className="flex items-center gap-2 2xl:gap-3 ">
						<LanguageSwitcher className="!hidden xl:!flex" isMobile={false} />
						<ThemeSwitcher
							theme={theme}
							setTheme={setTheme}
							isMounted={isMounted}
						/>
					</ul>
				</nav>
				<LoginModal
					isOpen={isLoginModalOpen}
					onOpenChange={onLoginModalOpenChange}
					onClose={onLoginModalClose}
				/>
				{!session ? (
					isLoginEnabled && (
						<Button
							startContent={
								<IoIosLogIn className="size-5 shrink-0" />
							}
							className={twMerge(
								"h-full xl:min-w-0 xl:pl-4  text-accent dark:text-accent py-1 xl:py-0",
								style === "small" ?
									"!p-0 rounded-full !size-10" : "uppercase"
							)}
							onPress={onLoginModalOpen}
							isIconOnly={style === "small"}
							aria-label={t("loginButtonAriaLabel")}
						>
							{style === "wide" ? t("login") : ""}
						</Button>
					)
				) : (
					<UserButton />
				)}
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
							className="xl:hidden ml-auto rtl:ml-0 rtl:mr-auto flex justify-center items-center"
						>
							<Button
								variant="invisible"
								aria-label={t("openMenuAriaLabel")}
								onPress={() => {
									setIsMobileMenuOpen(!isMobileMenuOpen);
								}}
							>
								<Icon className="size-8 !fill-accent !stroke-accent cursor-pointer transition-transform active:scale-80 delay-0" />
							</Button>
						</motion.div>
					))}
				</AnimatePresence>
			</div>
			<ul
				className={twMerge(
					"xl:hidden bg-[#EAE9E5] dark:bg-secondary-400 rounded-2xl rounded-t-none relative duration-300 overflow-y-hidden -z-10 flex flex-col gap-8",
					isMobileMenuOpen
						? "max-h-[calc(100vh-104px)] py-8 mb-4 opacity-100 shadow-xl shadow-[#EAE9E5] dark:shadow-secondary-400"
						: "max-h-0 opacity-0"
				)}
			>
				<li>
					<LinksList pathname={pathname} isMobile={true} />
				</li>
				<LanguageSwitcher className="w-full flex justify-center" isMobile={true} />
				<ThemeSwitcher
					theme={theme}
					setTheme={setTheme}
					isMounted={isMounted}
					isMobile={true}
				/>
			</ul>
			{/* {style === "wide" && <div className={twMerge("absolute hidden xl:flex inset-0 scale-x-[100] bg-white dark:bg-secondary -z-10", (isMapPage) && "scale-x-[200]")}>
			</div>} */}
		</header>
	);
}
