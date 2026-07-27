"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { HiOutlineMoon } from "react-icons/hi2";
import { IoMdSunny } from "react-icons/io";
import { DropdownItem } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import type { NavbarElementProps } from "@/types/navbar";

const subscribeToHydration = () => () => {};

export default function ThemeSwitcher({
	variant,
	styleVariant,
	showLabel,
}: NavbarElementProps) {
	const mounted = useSyncExternalStore(
		subscribeToHydration,
		() => true,
		() => false,
	);
	const { resolvedTheme, setTheme } = useTheme();
	const isEnabled = useFeatureFlagEnabled("theme-switcher");
	const { features, theme } = useLibraryConfig();
	const t = useTranslations("ui");

	if (
		!isEnabled ||
		!features.themeSwitcher ||
		theme.forcedMode
	) {
		return null;
	}

	const toggleTheme = () =>
		setTheme(resolvedTheme === "dark" ? "light" : "dark");

	const isDark = mounted && resolvedTheme === "dark";
	const targetTheme = isDark ? t("lightTheme") : t("darkTheme");
	const label = mounted
		? t("switchThemeAriaLabel", { theme: targetTheme })
		: "Toggle theme";

	// Menu item variant - for dropdowns and mobile menu
	if (variant === "menuItem") {
		return (
			<DropdownItem
				key="theme"
				onPress={toggleTheme}
				startContent={
					isDark ? (
						<IoMdSunny className="size-5 fill-accent" />
					) : (
						<HiOutlineMoon className="size-5 stroke-accent" />
					)
				}
			>
				{label}
			</DropdownItem>
		);
	}

	// Inline variant - standalone button
	return (
		<Button
			variant="invisible"
			disableRipple
			onPress={toggleTheme}
			aria-label={label}
			className="flex items-center justify-center gap-2"
		>
			<IoMdSunny
				className={twMerge(
					"size-5 fill-accent transition-all",
					"dark:block hidden"
				)}
			/>
			<HiOutlineMoon
				className={twMerge(
					"size-5 stroke-accent transition-all",
					"dark:hidden block"
				)}
			/>
			{showLabel && (
				<span
					className={twMerge(
						"text-lg text-accent",
						styleVariant === "wide" ? "uppercase" : ""
					)}
				>
					{["dark", "light"].map((themeToMatch) => (
						<span
							key={themeToMatch}
							aria-hidden={
								mounted
									? themeToMatch !== resolvedTheme
									: undefined
							}
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
	);
}
