"use client";

import { Login01Icon, Menu01Icon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { useTranslations } from "next-intl";
import {
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
import { useMockReaderSession } from "./MockReaderSession";
import { ReaderAvatar, readerMenuItems } from "./UserMenu";
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
	const { reader: session, signIn, signOut } = useMockReaderSession();
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
				signIn();
				break;
		}
	};

	// Determine trigger: avatar if logged in, hamburger if not
	const trigger = session ? (
		<ReaderAvatar reader={session} asTrigger />
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
				{/* Who is signed in comes first, then their account, then the rest. */}
				<DropdownSection showDivider={hasUser} className={hasUser ? "mb-1" : "hidden"}>
					{session ? (
						readerMenuItems({
							reader: session,
							t,
							onProfile: () => router.push(`/profile/${session.id}`),
							onSignOut: signOut,
						}).slice(0, 1)
					) : (
						<DropdownItem key="reader-placeholder" className="hidden">
							{" "}
						</DropdownItem>
					)}
				</DropdownSection>
				<DropdownSection
					showDivider={hasUser && (hasTheme || hasLanguages)}
					className={hasUser ? "mb-1" : "hidden"}
				>
					{session ? (
						readerMenuItems({
							reader: session,
							t,
							onProfile: () => router.push(`/profile/${session.id}`),
							onSignOut: signOut,
						}).slice(1)
					) : (
						<DropdownItem key="user-placeholder" className="hidden">
							{" "}
						</DropdownItem>
					)}
				</DropdownSection>
				{/* We need to flatten the children based on conditions */}
				<DropdownSection
					showDivider={hasTheme || hasLogin}
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
							{t("signIn")}
						</DropdownItem>
					) : (
						<DropdownItem key="login-placeholder" className="hidden">
							{" "}
						</DropdownItem>
					)}
				</DropdownSection>

			</DropdownMenu>
		</Dropdown>
	);
}
