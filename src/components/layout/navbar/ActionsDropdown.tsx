"use client";

import { Login01Icon, Menu01Icon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Logout01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
	Avatar,
	DropdownItem,
	DropdownMenu,
	DropdownSection,
	DropdownTrigger,
} from "@nextui-org/react";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Button } from "@/components/nextui/Button";
import { useSortedLocales } from "@/hooks/useSortedLocales";
import { useRuntimeLocaleNavigation } from "@/hooks/useRuntimeLocaleNavigation";
import { useTheme } from "next-themes";
import { useRouter } from "@/i18n/routing";
import { signOut } from "next-auth/react";
import ThemeSwitcher from "./ThemeSwitcher";
import LoginButton from "./LoginButton";
import LanguageSwitcher from "./LanguageSwitcher";
import type { NavbarContext } from "@/types/navbar";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";

interface ActionsDropdownProps {
	context: NavbarContext;
}

export default function ActionsDropdown({ context }: ActionsDropdownProps) {
	const t = useTranslations("ui");
	const { data: session } = useSession();
	const { resolvedTheme: theme, setTheme } = useTheme();
	const router = useRouter();
	const changeLocale = useRuntimeLocaleNavigation();
	const { sortedLocales, localesNames } = useSortedLocales();
	const isThemeEnabled = useLibraryFeature("themeSwitcher");
	const isLanguageEnabled =
		useLibraryFeature("languageSwitcher");
	const isLoginEnabled = useLibraryFeature("login");

	const hasLanguages = isLanguageEnabled && sortedLocales.length > 0;
	const hasTheme = isThemeEnabled;
	const hasLogin = isLoginEnabled && !session;
	const hasUser = !!session;

	// Count actionable items for single-item logic
	// Languages always need dropdown, so we handle them separately
	const singleActionItems = (hasTheme ? 1 : 0) + (hasLogin ? 1 : 0);
	const totalItems = singleActionItems + (hasLanguages ? 1 : 0) + (hasUser ? 1 : 0);

	// If nothing to show, return null
	if (totalItems === 0) return null;

	// If only one item and not logged in, render it directly (not in dropdown)
	// This keeps the original behavior where a single action doesn't get wrapped in a hamburger
	if (totalItems === 1 && !session) {
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
					onAction={context.onLoginModalOpen}
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
		const selectedLocale = sortedLocales.find(
			(locale) => locale === keyStr,
		);
		if (selectedLocale) {
			changeLocale(selectedLocale);
			return;
		}

		switch (keyStr) {
			case "theme":
				setTheme(theme === "dark" ? "light" : "dark");
				break;
			case "login":
				context.onLoginModalOpen();
				break;
			case "profile":
				router.push(`/profile/${session?.user?.id}`);
				break;
			case "logout":
				signOut({ redirect: false });
				break;
		}
	};

	// Determine trigger: avatar if logged in, hamburger if not
	const trigger = session ? (
		<Avatar
			as="button"
			className="cursor-pointer"
			src={session.user?.image ?? "/icons/profile.png"}
			alt={t("userAvatarAlt", {
				name: session.user?.name || session.user?.email || t("genericUser"),
			})}
		/>
	) : (
		<Button
			variant="invisible"
			disableRipple
			isIconOnly
			className="flex items-center justify-center"
			aria-label={t("actionsMenuAriaLabel")}
		>
			<HugeiconsIcon icon={Menu01Icon} className="size-5 text-accent" />
		</Button>
	);

	const isDark = theme === "dark";

	// Render based on what sections are available
	// Using conditional rendering within the children directly
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
				{/* We need to flatten the children based on conditions */}
				<DropdownSection
					showDivider={hasTheme || hasLogin || hasUser}
					classNames={{ base: "mb-0 mt-0" }}
					className={hasLanguages ? "" : "hidden"}
				>
					{sortedLocales.map((locale) => (
						<DropdownItem key={locale}>
							{localesNames[locale as keyof typeof localesNames]}
						</DropdownItem>
					))}
				</DropdownSection>

				<DropdownSection
					showDivider={hasUser}
					className={hasTheme || hasLogin ? "my-1 mt-1.5" : "hidden"}
				>
					{hasTheme ? (
						<DropdownItem
							key="theme"
							startContent={
								isDark ? (
									<HugeiconsIcon icon={Sun03Icon} className="size-5 text-accent" />
								) : (
									<HugeiconsIcon icon={Moon02Icon} className="size-5 text-accent" />
								)
							}
						>
							{t("switchThemeAriaLabel", {
								theme: isDark ? t("lightTheme") : t("darkTheme"),
							})}
						</DropdownItem>
					) : (
						<DropdownItem key="theme-placeholder" className="hidden">
							{" "}
						</DropdownItem>
					)}
					{hasLogin ? (
						<DropdownItem
							key="login"
							startContent={<HugeiconsIcon icon={Login01Icon} className="size-5" />}
						>
							{t("login")}
						</DropdownItem>
					) : (
						<DropdownItem key="login-placeholder" className="hidden">
							{" "}
						</DropdownItem>
					)}
				</DropdownSection>

				<DropdownSection className={hasUser ? "mb-0" : "hidden"}>
					{hasUser ? (
						<>
							<DropdownItem
								key="profile"
								startContent={<HugeiconsIcon icon={UserIcon} className="size-4" />}
							>
								{t("profileMenuItem")}
							</DropdownItem>
							<DropdownItem
								key="logout"
								color="danger"
								startContent={<HugeiconsIcon icon={Logout01Icon} className="size-4" />}
								className="text-danger"
							>
								{t("logout")}
							</DropdownItem>
						</>
					) : (
						<DropdownItem key="user-placeholder" className="hidden">
							{" "}
						</DropdownItem>
					)}
				</DropdownSection>
			</DropdownMenu>
		</Dropdown>
	);
}
