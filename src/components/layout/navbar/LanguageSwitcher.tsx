"use client";

import { useTranslations } from "next-intl";
import { DropdownItem, DropdownTrigger } from "@nextui-org/react";
import { ChevronDownIcon } from "@nextui-org/shared-icons";
import { twMerge } from "@/lib/tw-merge";
import { Button } from "@/components/nextui/Button";
import { Dropdown } from "@/components/nextui/Dropdown";
import { DropdownMenu } from "@nextui-org/react";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useRuntimeLocaleNavigation } from "@/hooks/useRuntimeLocaleNavigation";
import { useSortedLocales } from "@/hooks/useSortedLocales";
import type { NavbarElementProps } from "@/types/navbar";

export default function LanguageSwitcher({
	variant,
	styleVariant,
}: NavbarElementProps) {
	const changeLocale = useRuntimeLocaleNavigation();
	const {
		currentLocaleName,
		sortedLocales,
		localesNames,
	} = useSortedLocales();
	const isEnabled = useLibraryFeature("languageSwitcher");
	const t = useTranslations("ui");

	if (!isEnabled) return null;

	// Menu item variant - returns individual items for each locale
	if (variant === "menuItem") {
		return (
			<>
				{sortedLocales.map((locale) => (
					<DropdownItem key={locale} onPress={() => changeLocale(locale)}>
						{localesNames[locale as keyof typeof localesNames]}
					</DropdownItem>
				))}
			</>
		);
	}

	// Inline variant - dropdown with current locale as trigger
	return (
		<Dropdown>
			<DropdownTrigger className="cursor-pointer select-none">
				<Button
					variant="invisible"
					tabIndex={0}
					disableRipple
					className={twMerge(
						"flex items-center gap-2 !px-2 justify-center",
						styleVariant === "wide" && "uppercase"
					)}
					aria-label={t("languageSwitcherAriaLabel")}
				>
					<span className="text-lg font-medium">{currentLocaleName}</span>
					<ChevronDownIcon className="size-4" />
				</Button>
			</DropdownTrigger>
			<DropdownMenu
				onAction={(key) => {
					const locale = sortedLocales.find(
						(candidate) => candidate === String(key),
					);
					if (locale) changeLocale(locale);
				}}
				aria-label={t("languageMenuAriaLabel")}
			>
				{sortedLocales.map((locale) => (
					<DropdownItem key={locale}>
						{localesNames[locale as keyof typeof localesNames]}
					</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	);
}
