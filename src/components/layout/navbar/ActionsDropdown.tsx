"use client";

import { Login01Icon, Menu01Icon, Moon02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { useTranslations } from "next-intl";
import { DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger } from "@nextui-org/react";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Button } from "@/components/nextui/Button";
import { useSortedLocales } from "@/hooks/useSortedLocales";
import { useRuntimeLocaleNavigation } from "@/hooks/useRuntimeLocaleNavigation";
import { useTheme } from "next-themes";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/routing";
import ThemeSwitcher from "./ThemeSwitcher";
import LoginButton from "./LoginButton";
import LanguageSwitcher from "./LanguageSwitcher";
import type { NavbarContext } from "@/types/navbar";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useMockReaderSession } from "./MockReaderSession";
import { ReaderAvatar, readerMenuGroups } from "./UserMenu";
import {
	NavbarMenuIcon,
	NavbarMenuSwitch,
	navbarMenuClasses,
	navbarMenuDropdownClasses,
	navbarMenuItemClasses,
	navbarMenuSectionClasses,
	navbarMenuSignInClasses,
} from "./menuStyles";

interface ActionsDropdownProps {
	context: NavbarContext;
}

/**
 * The header's actions when they do not fit beside the links: who is signed
 * in and their account first, then the library's settings, then signing in or
 * out. Each group is one section, so the dividers are the only gaps.
 */
export default function ActionsDropdown({ context }: ActionsDropdownProps) {
	const t = useTranslations("ui");
	const { reader, signIn, signOut } = useMockReaderSession();
	const { resolvedTheme: theme, setTheme } = useTheme();
	const router = useRouter();
	const currentLocale = useLocale();
	const changeLocale = useRuntimeLocaleNavigation();
	const { sortedLocales, localesNames } = useSortedLocales();
	const hasTheme = useLibraryFeature("themeSwitcher");
	const hasLanguages = useLibraryFeature("languageSwitcher") && sortedLocales.length > 0;
	const hasLogin = useLibraryFeature("login") && !reader;

	const totalItems = (hasTheme ? 1 : 0) + (hasLogin ? 1 : 0) + (hasLanguages ? 1 : 0) + (reader ? 1 : 0);
	if (totalItems === 0) return null;

	// A single action needs no menu.
	if (totalItems === 1 && !reader) {
		if (hasTheme) return <ThemeSwitcher variant="inline" styleVariant={context.styleVariant} />;
		if (hasLogin) return <LoginButton variant="inline" styleVariant={context.styleVariant} />;
		return <LanguageSwitcher variant="inline" styleVariant={context.styleVariant} />;
	}

	const isDark = theme === "dark";
	const settings = [
		...(hasTheme
			? [
					<DropdownItem
						key="theme"
						onPress={() => setTheme(isDark ? "light" : "dark")}
						startContent={<NavbarMenuIcon icon={Moon02Icon} />}
						endContent={<NavbarMenuSwitch on={isDark} />}
						textValue={t("darkMode")}
					>
						{t("darkMode")}
					</DropdownItem>,
				]
			: []),
		...(hasLanguages
			? sortedLocales.map((locale) => (
					<DropdownItem
						key={`locale-${locale}`}
						onPress={() => changeLocale(locale)}
						endContent={locale === currentLocale ? <NavbarMenuIcon icon={Tick02Icon} className="text-accent dark:text-accent" /> : null}
					>
						{localesNames[locale as keyof typeof localesNames]}
					</DropdownItem>
				))
			: []),
	];

	const groups = reader
		? readerMenuGroups({
				reader,
				t,
				onProfile: () => router.push(`/profile/${reader.id}`),
				onSignOut: signOut,
			})
		: null;

	const sections = [
		...(groups
			? [
					<DropdownSection key="reader" showDivider classNames={navbarMenuSectionClasses}>
						{groups.identity}
					</DropdownSection>,
					<DropdownSection key="account" showDivider classNames={navbarMenuSectionClasses}>
						{groups.account}
					</DropdownSection>,
				]
			: []),
		...(settings.length > 0
			? [
					<DropdownSection key="settings" showDivider={Boolean(groups) || hasLogin} classNames={navbarMenuSectionClasses}>
						{settings}
					</DropdownSection>,
				]
			: []),
		groups ? (
			<DropdownSection key="sign-out" classNames={navbarMenuSectionClasses}>
				{groups.signOut}
			</DropdownSection>
		) : hasLogin ? (
			<DropdownSection key="sign-in" classNames={navbarMenuSectionClasses}>
				<DropdownItem
					key="login"
					onPress={signIn}
					startContent={<HugeiconsIcon icon={Login01Icon} aria-hidden className="size-5 shrink-0" />}
					className={navbarMenuSignInClasses}
				>
					{t("signIn")}
				</DropdownItem>
			</DropdownSection>
		) : null,
	].filter((section) => section !== null);

	return (
		<Dropdown placement="bottom-end" classNames={navbarMenuDropdownClasses}>
			<DropdownTrigger>
				{reader ? (
					<ReaderAvatar reader={reader} asTrigger />
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
				)}
			</DropdownTrigger>
			<DropdownMenu aria-label={t("actionsMenuAriaLabel")} classNames={navbarMenuClasses} itemClasses={navbarMenuItemClasses}>
				{sections}
			</DropdownMenu>
		</Dropdown>
	);
}
