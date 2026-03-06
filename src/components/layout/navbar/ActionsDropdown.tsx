"use client";

import { useTranslations } from "next-intl";
import { useClerk } from "@clerk/nextjs";
import { GiHamburgerMenu } from "react-icons/gi";
import {
	Avatar,
	DropdownItem,
	DropdownMenu,
	DropdownSection,
	DropdownTrigger,
} from "@heroui/react";
import { Dropdown } from "@/components/heroui/Dropdown";
import { Button } from "@/components/heroui/Button";
import { useSortedLocales } from "@/hooks/useSortedLocales";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { useRouter, usePathname } from "@/i18n/routing";
import { IoIosLogIn } from "react-icons/io";
import { User, LogOut } from "lucide-react";
import ThemeSwitcher from "./ThemeSwitcher";
import LoginButton from "./LoginButton";
import LanguageSwitcher from "./LanguageSwitcher";
import type { NavbarContext } from "@/types/navbar";
import { HiOutlineMoon } from "react-icons/hi2";
import { IoMdSunny } from "react-icons/io";
import { useNavbarAuthState } from "./useNavbarAuthState";

interface ActionsDropdownProps {
	context: NavbarContext;
}

export default function ActionsDropdown({ context }: ActionsDropdownProps) {
	const t = useTranslations("ui");
	const { openSignIn, signOut } = useClerk();
	const router = useRouter();
	const pathname = usePathname();
	const { sortedLocales, localesNames } = useSortedLocales();
	const {
		hasResolvedIdentity,
		isLoaded,
		isSignedIn,
		navbarSession,
		profileHref,
		session,
		user,
	} = useNavbarAuthState();

	const isThemeEnabled = useFeatureFlagEnabled("theme-switcher");
	const isLanguageEnabled = useFeatureFlagEnabled("language-switcher");
	const isLoginEnabled = useFeatureFlagEnabled("login");
	const isDarkTheme = context.theme === "dark";
	const hasUser = Boolean(navbarSession);
	const hasUserActions = isLoaded && isSignedIn;
	const userName =
		user?.fullName ||
		user?.primaryEmailAddress?.emailAddress ||
		session?.user?.name ||
		session?.user?.email ||
		t("genericUser");
	const userImage = user?.imageUrl ?? session?.user?.image ?? "/icons/profile.png";
	const themeTarget = isDarkTheme ? "light" : "dark";
	const themeLabel = t("switchThemeAriaLabel", {
		theme: t(themeTarget === "light" ? "lightTheme" : "darkTheme"),
	});

	const hasLanguages = isLanguageEnabled && sortedLocales.length > 0;
	const hasTheme = isThemeEnabled;
	const hasLogin = isLoginEnabled && !hasUser;

	// Count actionable items for single-item logic
	// Languages always need dropdown, so we handle them separately
	const singleActionItems = (hasTheme ? 1 : 0) + (hasLogin ? 1 : 0);
	const totalItems =
		singleActionItems + (hasLanguages ? 1 : 0) + (hasUser ? 1 : 0);

	// If nothing to show, return null
	if (totalItems === 0) return null;

	// If only one item and not logged in, render it directly (not in dropdown)
	// This keeps the original behavior where a single action doesn't get wrapped in a hamburger
	if (totalItems === 1 && !hasUser) {
		if (hasTheme) {
			return (
				<ThemeSwitcher
					variant="inline"
					styleVariant={context.styleVariant}
				/>
			);
		}
		if (hasLogin) {
			return (
				<LoginButton
					variant="inline"
					styleVariant={context.styleVariant}
				/>
			);
		}
		if (hasLanguages) {
			return (
				<LanguageSwitcher
					variant="inline"
					styleVariant={context.styleVariant}
				/>
			);
		}
	}

	// Build action items
	const handleAction = (key: React.Key) => {
		const keyStr = String(key);

		// Check if it's a locale key
		if (sortedLocales.includes(keyStr)) {
			router.push(pathname, { locale: keyStr });
			return;
		}

		switch (keyStr) {
			case "login":
				if (!hasUser) {
					try {
						openSignIn();
					} catch (error: any) {
						const code = error?.errors?.[0]?.code;
						if (code !== "cannot_render_single_session_enabled") {
							throw error;
						}
					}
				}
				break;
			case "profile":
				router.push(profileHref);
				break;
			case "logout":
				void signOut();
				break;
		}
	};

	// Determine trigger: avatar if logged in, hamburger if not
	const trigger = hasUser ? (
		hasResolvedIdentity ? (
			<Avatar
				as="button"
				className="size-10 cursor-pointer"
				aria-label={t("actionsMenuAriaLabel")}
				src={userImage}
				alt={t("userAvatarAlt", { name: userName })}
			/>
		) : (
			<Button
				variant="invisible"
				disableRipple
				isIconOnly
				className="flex items-center justify-center !p-0 !size-10 rounded-full"
				aria-label={t("actionsMenuAriaLabel")}
			>
				<div
					aria-hidden="true"
					className="size-10 rounded-full animate-pulse bg-zinc-300/90 ring-1 ring-zinc-400/60 dark:bg-zinc-200/30 dark:ring-zinc-100/60"
				/>
			</Button>
		)
	) : (
		<Button
			variant="invisible"
			disableRipple
			isIconOnly
			className="flex items-center justify-center"
			aria-label={t("actionsMenuAriaLabel")}
		>
			<GiHamburgerMenu className="size-5 fill-accent" />
		</Button>
	);

	const menuSections = [];

	if (hasLanguages) {
		menuSections.push(
			<DropdownSection
				key="languages"
				showDivider={hasTheme || hasLogin || hasUser}
				classNames={{ base: "mb-0 mt-0" }}
			>
				{sortedLocales.map((locale) => (
					<DropdownItem key={locale}>
						{localesNames[locale as keyof typeof localesNames]}
					</DropdownItem>
				))}
			</DropdownSection>
		);
	}

	if (hasTheme || hasLogin) {
		const preferenceItems = [];

		if (hasTheme) {
			preferenceItems.push(
				<DropdownItem
					key="theme"
					onPress={() =>
						context.setTheme(isDarkTheme ? "light" : "dark")
					}
					startContent={
						isDarkTheme ? (
							<IoMdSunny className="size-5 fill-accent" />
						) : (
							<HiOutlineMoon className="size-5 stroke-accent" />
						)
					}
				>
					{themeLabel}
				</DropdownItem>
			);
		}

		if (hasLogin) {
			preferenceItems.push(
				<DropdownItem
					key="login"
					startContent={<IoIosLogIn className="size-5" />}
				>
					{t("login")}
				</DropdownItem>
			);
		}

		menuSections.push(
			<DropdownSection
				key="preferences"
				showDivider={hasUser}
				className="my-1 mt-1.5"
			>
				{preferenceItems}
			</DropdownSection>
		);
	}

	if (hasUserActions) {
		menuSections.push(
			<DropdownSection key="user" className="mb-0">
				<DropdownItem
					key="profile"
					startContent={<User className="size-4" />}
				>
					{t("profileMenuItem")}
				</DropdownItem>
				<DropdownItem
					key="logout"
					color="danger"
					startContent={<LogOut className="size-4" />}
					className="text-danger"
				>
					{t("logout")}
				</DropdownItem>
			</DropdownSection>
		);
	}

	if (menuSections.length === 0) {
		return trigger;
	}

	return (
		<Dropdown>
			<DropdownTrigger>{trigger}</DropdownTrigger>
			<DropdownMenu
				aria-label={t("actionsMenuAriaLabel")}
				onAction={handleAction}
				className="p-1 gap-0"
				itemClasses={{
					title: "font-medium",
				}}
			>
				{menuSections}
			</DropdownMenu>
		</Dropdown>
	);
}
