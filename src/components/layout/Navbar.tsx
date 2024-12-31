"use client";

import Image from "next/image";
import { localesNames, routing, usePathname, useRouter } from "@/i18n/routing";
import { twMerge } from "tailwind-merge";
import { links } from "@/constants/links";
import { useTheme } from "next-themes";
import { HiOutlineMoon } from "react-icons/hi2";
import { IoMdSunny } from "react-icons/io";
import { useState, useEffect, useCallback, useRef } from "react";
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
import { LinkObject } from "@/types/links";
import { Button } from "../nextui/Button";
import { BiError, BiErrorCircle, BiLogIn, BiLogOut } from "react-icons/bi";
import { signIn, signOut, useSession } from "next-auth/react";
import { Input } from "../nextui/Input";
import AIModal from "../nextui/AIModal";
import GenericHeader from "../features/modals/GenericHeader";
import { FaGoogle, FaEnvelope, FaLock } from "react-icons/fa";
import { authenticate } from "@/lib/actions";
import { Router } from "next/router";

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
				{[IoMdSunny, HiOutlineMoon].map((Icon, index) => (
					<Icon
						key={index}
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
								key={themeToMatch}
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
			</div>
		</Skeleton>
	);
}

function Logo({ interactive = true }: { interactive?: boolean }) {
	const [isLoaded, setIsLoaded] = useState(false);

	const logoContent = (
		<div className={twMerge("transition-all select-none", interactive && "cursor-pointer hover:brightness-90 hover:scale-95 active:scale-105 ")}>
			{["dark", "light"].map((themeToMatch) => (
				<Image
					key={themeToMatch}
					onLoad={() => setIsLoaded(true)}
					src={
						themeToMatch === "dark"
							? `/logos/${style}/logo.png`
							: `/logos/${style}/logo_light.png`
					}
					alt="logo"
					className={twMerge(
						"pointer-events-none",
						themeToMatch === "light"
							? "dark:hidden"
							: "hidden dark:block"
					)}
					height={40}
					width={171}
				/>
			))}
		</div>
	);

	return (
		<Skeleton
			isLoaded={isLoaded}
			className="w-[171px] h-[40px] rounded-lg "
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

function LanguageSwitcher({ className }: { className?: string }) {
	const router = useRouter();
	const locale = useLocale();
	const pathname = usePathname();

	return (
		<Dropdown>
			<DropdownTrigger
				className={twMerge("cursor-pointer select-none", className)}
			>
				<div
					data-style={style}
					className="relative flex items-center gap-2 data-[style=edtechhub]:uppercase"
				>
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
				{routing.locales
					.filter((currentLocale) => currentLocale !== locale)
					.map((locale) => (
						<DropdownItem key={locale}>
							{localesNames[locale as keyof typeof localesNames]}
						</DropdownItem>
					))}
			</DropdownMenu>
		</Dropdown>
	);
}

function UserButton() {
	const { data: session } = useSession();
	const router = useRouter();
	return (
		<Dropdown>
			<DropdownTrigger>
				<Avatar src={session?.user?.image ?? ""} />
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
	const ANIMATION_DURATION = 0.5;

	const router = useRouter();
	const containerRef = useRef<HTMLDivElement>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [debouncedSetErrorMessage, _] = useDebounce(
		() => setErrorMessage(null),
		ANIMATION_DURATION * 5 * 1000
	);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
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
		if (
			result?.error &&
			containerRef.current?.parentElement?.parentElement
		) {
			setErrorMessage(result.error);
			debouncedSetErrorMessage();
			const originalColor =
				containerRef.current.parentElement.parentElement.style
					.backgroundColor;
			animate(
				containerRef.current.parentElement.parentElement,
				{
					x: [-10, 10, -10, 10, -5, 5, -2, 2, 0],
				},
				{ duration: ANIMATION_DURATION }
			);
		} else if (!result?.error) {
			onClose();
		}
	};

	return (
		<AIModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent
				className={twMerge(
					"transition-colors duration-500",
					errorMessage && "!bg-red-800/25"
				)}
			>
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
										<FaEnvelope className="size-5 mr-1 fill-black dark:fill-white/40" />
									}
									name="email"
									placeholder="Email"
								/>
								<Input
									startContent={
										<FaLock className="size-5 mr-1 fill-black dark:fill-white/40" />
									}
									type="password"
									name="password"
									placeholder="Password"
								/>
								<div className="flex items-center gap-2 h-10">
									<Button
										color="accent"
										className="w-full h-full"
										type="submit"
									>
										Login
									</Button>
									<Button
										color="secondary"
										className="w-full h-full"
										data-register
										type="submit"
									>
										Register
									</Button>
								</div>
							</form>
							<AnimatePresence mode="sync">
								{errorMessage && (
									<motion.div
										initial={{ height: 0, opacity: 0, y: 8 }}
										animate={{ height: "auto", opacity: 1 }}
										exit={{ height: 0, opacity: 0, y: 0 }}
										className="bg-red-800/50 rounded-2xl overflow-hidden"
									>
										<div className="p-2 grid grid-cols-[auto_1fr] gap-2">
											<BiErrorCircle className="size-8 p-1 aspect-square bg-black/50 rounded-full" />
											<span className="text-sm flex items-center">
												{errorMessage}
											</span>
										</div>
									</motion.div>
								)}
							</AnimatePresence>
						</div>
						<div className="flex items-center gap-4 my-4">
							<div className="flex-1 h-[1px] bg-black/10 dark:bg-white/10" />
							<span className="text-black/60 dark:text-white/60">
								Or
							</span>
							<div className="flex-1 h-[1px] bg-black/10 dark:bg-white/10" />
						</div>
						<Button
							onClick={() => signIn("google")}
							color="secondary"
							className="w-full dark:bg-white dark:text-black"
							startContent={<FaGoogle className="size-5" />}
						>
							Continue with Google
						</Button>
					</div>
				</ModalBody>
			</ModalContent>
		</AIModal>
	);
}

export default function Navbar() {
	const pathname = usePathname();
	const [isMounted, setIsMounted] = useState(false);
	const { theme, setTheme } = useTheme();
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const { data: session } = useSession();
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
				<Logo />
				<LinksList pathname={pathname} />
				<LanguageSwitcher className="!hidden xl:!flex" />
				<ThemeSwitcher
					theme={theme}
					setTheme={setTheme}
					isMounted={isMounted}
				/>
				<LoginModal
					isOpen={isLoginModalOpen}
					onOpenChange={onLoginModalOpenChange}
					onClose={onLoginModalClose}
				/>
				{!session ? (
					<Button
						startContent={<BiLogIn className="size-5 shrink-0" />}
						color={"accent"}
						className={twMerge("h-full xl:min-w-0 xl:pl-4")}
						onPress={onLoginModalOpen}
					>
						Login
					</Button>
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
				<LanguageSwitcher className="w-full flex justify-center" />
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
