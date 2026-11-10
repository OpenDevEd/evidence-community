"use client";

import { useTranslations } from "next-intl";
import { DropdownItem, DropdownMenu, DropdownTrigger } from "@nextui-org/react";
import { ArrowDown01Icon, LanguageSkillIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { twMerge } from "@/lib/tw-merge";
import { Button } from "@/components/nextui/Button";
import { Dropdown } from "@/components/nextui/Dropdown";
import { useLibraryConfig, useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useRuntimeLocaleNavigation } from "@/hooks/useRuntimeLocaleNavigation";
import { useSortedLocales } from "@/hooks/useSortedLocales";
import { getOrderedRuntimeLocales } from "@/i18n/runtime";
import { intlLocale } from "@/i18n/intl-locale";
import { localesNames } from "@/i18n/routing";
import type { NavbarElementProps } from "@/types/navbar";
import {
	NavbarMenuIcon,
	navbarMenuClasses,
	navbarMenuDropdownClasses,
	navbarMenuItemClasses,
} from "./menuStyles";

export function languageName(locale: string) {
	return localesNames[locale as keyof typeof localesNames] ?? locale;
}

/** Every language the library offers, the current one ticked, in the library's order. */
export function languageMenuItems<Locale extends string>(input: {
	locales: readonly Locale[];
	current: string;
	onSelect: (locale: Locale) => void;
}) {
	return input.locales.map((locale) => (
		<DropdownItem
			key={`locale-${locale}`}
			lang={intlLocale(locale)}
			onPress={() => input.onSelect(locale)}
			endContent={
				locale === input.current ? (
					<NavbarMenuIcon icon={Tick02Icon} className="text-accent dark:text-accent" />
				) : null
			}
		>
			{languageName(locale)}
		</DropdownItem>
	));
}

/** All of the library's languages, the current one included. */
export function useLibraryLanguages() {
	const { localization } = useLibraryConfig();
	return getOrderedRuntimeLocales(localization);
}

export default function LanguageSwitcher({ variant }: NavbarElementProps) {
	const changeLocale = useRuntimeLocaleNavigation();
	const { currentLocale } = useSortedLocales();
	const locales = useLibraryLanguages();
	const isEnabled = useLibraryFeature("languageSwitcher");
	const t = useTranslations("ui");

	if (!isEnabled || locales.length < 2) return null;

	const items = languageMenuItems({ locales, current: currentLocale, onSelect: changeLocale });
	if (variant === "menuItem") return <>{items}</>;

	// The language's own name says more than a code such as EN-GB.
	return (
		<Dropdown placement="bottom-end" classNames={navbarMenuDropdownClasses}>
			<DropdownTrigger>
				<Button
					variant="invisible"
					disableRipple
					className={twMerge("flex h-10 items-center gap-2 !px-2 justify-center text-foreground/70 dark:text-white/70")}
					aria-label={t("languageSwitcherAriaLabel")}
				>
					<NavbarMenuIcon icon={LanguageSkillIcon} className="text-accent dark:text-accent" />
					<span className="text-lg font-medium">{languageName(currentLocale)}</span>
					<NavbarMenuIcon icon={ArrowDown01Icon} className="size-4" />
				</Button>
			</DropdownTrigger>
			<DropdownMenu aria-label={t("languageMenuAriaLabel")} classNames={navbarMenuClasses} itemClasses={navbarMenuItemClasses}>
				{items}
			</DropdownMenu>
		</Dropdown>
	);
}
