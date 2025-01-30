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
} from "@nextui-org/react";
import { ChevronDownIcon } from "@nextui-org/shared-icons";
import { useDebounce } from "@/hooks/useDebounce";
import { useLocale, useTranslations } from "next-intl";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Link } from "@/i18n/routing";
import { Button } from "../nextui/Button";
import { BiError, BiErrorCircle, BiLogIn, BiLogOut } from "react-icons/bi";
import { signIn, signOut, useSession } from "next-auth/react";
import { Input } from "../nextui/Input";
import AIModal from "../nextui/AIModal";
import GenericHeader from "../features/modals/GenericHeader";
import { FaGoogle, FaEnvelope, FaLock } from "react-icons/fa";
import { authenticate } from "@/lib/auth";
import { Router } from "next/router";
import { useModalError } from "@/hooks/useModalError";
import { useFeatureFlagEnabled, useStatus } from "@/context/Providers";
import { LinkObject } from "@/db/schema/tables/status";
import DialogModal from "../nextui/DialogModal";

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
		<li
			className={twMerge(
				"h-6 w-6 rounded-lg",
				isMobile ? "xl:hidden block w-full" : "xl:block hidden"
			)}
		>
			<Button
				suppressHydrationWarning
				className="flex items-center justify-center gap-2 !w-full"
				variant="invisible"
				disableRipple
				onPress={() => {
					setTheme(theme === "dark" ? "light" : "dark");
				}}
				aria-label={`Switch to ${
					theme === "dark" ? "light" : "dark"
				} mode`}
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
					<span className="text-sm text-accent">
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
	);
}

function Logo({ interactive = true }: { interactive?: boolean }) {
	const [isLoaded, setIsLoaded] = useState(false);
	const status = useStatus();
	const { theme } = useTheme();
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
					alt={`${status?.companyName} full company logo with text in ${themeToMatch} mode`}
					height={40}
					width={171}
				/>
			))}
		</div>
	);

	return (
		<Skeleton
			isLoaded={isLoaded}
			className="w-[10.6875rem] h-[2.5rem] rounded-lg "
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
				className={twMerge(
					"flex  gap-2 text-lg items-center justify-center font-medium",
					style === "wide" && "uppercase font-base"
				)}
			>
				{link.icon &&
					Object.entries(NAVBAR_ICONS)
						.filter(([key]) => key === link.icon)
						.map(([key, Value]) => (
							<Value
								key={key}
								aria-label={`Icon for ${t(link.label)} link`}
								className={twMerge(
									"fill-current size-6 shrink-0",
									style === "wide" && "size-5"
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
							aria-label={`${link.label} dropdown`}
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
				isMobile && "flex-col gap-8",
				!isMobile && "hidden xl:flex"
			)}
		>
			{links.map(
				(link, index) =>
					!link.navExclude && (
						<LinkItem link={link} pathname={pathname} key={index} />
					)
			)}
		</ul>
	);
}

function LanguageSwitcher({ className }: { className?: string }) {
	const router = useRouter();
	const locale = useLocale();
	const pathname = usePathname();

	return (
		<li
			data-style={style}
			className="relative flex items-center gap-2 data-[style=wide]:uppercase"
		>
			<Dropdown>
				<DropdownTrigger
					className={twMerge("cursor-pointer select-none", className)}
				>
					<Button
						variant="invisible"
						tabIndex={0}
						disableRipple
						className="flex items-center gap-2 !px-2"
					>
						<div className="text-lg font-medium">
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
					{routing.locales
						.filter((currentLocale) => currentLocale !== locale)
						.map((locale) => (
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
	);
}

function UserButton() {
	const { data: session } = useSession();
	const router = useRouter();
	return (
		<Dropdown>
			<DropdownTrigger>
				<Avatar
					src={session?.user?.image ?? ""}
					alt={`${
						session?.user?.name || session?.user?.email || "User"
					}'s avatar`}
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
				<DropdownItem key="profile">Profile</DropdownItem>
				<DropdownItem key="settings">Settings</DropdownItem>
				<DropdownItem key="logout" color="danger">
					Logout
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
					<Logo interactive={false} />
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
	useEffect(() => {
		setIsMounted(true);
	}, []);

	return (
		<header
			className={twMerge(
				"w-full max-w-[96rem] px-0 xl:px-14 sticky top-0 xl:relative z-50 pt-0 print:hidden",
				style === "wide" && "bg-white dark:bg-secondary max-w-none"
			)}
		>
			<div
				className={twMerge(
					"xl:h-[6.5rem] bg-white dark:bg-secondary xl:rounded-2xl flex items-center p-4 py-6 xl:p-8 gap-6 z-10",
					style === "wide" &&
						"bg-transparent max-w-[96rem] mx-auto xl:px-14 gap-6"
				)}
			>
				<Logo />
				<nav aria-label="Main navigation" className="flex-1">
					<LinksList pathname={pathname} />
				</nav>
				<nav aria-label="Secondary navigation">
					<ul className="flex items-center gap-3">
						<LanguageSwitcher className="!hidden xl:!flex" />
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
							aria-label={"Login/Register button"}
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
							className="xl:hidden block ml-auto rtl:ml-0 rtl:mr-auto"
						>
							<Button
								variant="invisible"
								aria-label={"Open hamburger menu"}
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
				<LanguageSwitcher className="w-full flex justify-center" />
				<ThemeSwitcher
					theme={theme}
					setTheme={setTheme}
					isMounted={isMounted}
					isMobile={true}
				/>
			</ul>
		</header>
	);
}
