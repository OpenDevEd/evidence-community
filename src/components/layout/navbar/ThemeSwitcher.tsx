"use client";

import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { HiOutlineMoon } from "react-icons/hi2";
import { IoMdSunny } from "react-icons/io";
import { DropdownItem } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";
import { useFeatureFlagEnabled } from "@/context/Providers";
import type { NavbarElementProps } from "@/types/navbar";

export default function ThemeSwitcher({
	variant,
	styleVariant,
	showLabel,
}: NavbarElementProps) {
	const { resolvedTheme: theme, setTheme } = useTheme();
	const isEnabled = useFeatureFlagEnabled("theme-switcher");
	const t = useTranslations("ui");

	if (!isEnabled) return null;

	const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
	const isDark = theme === "dark";
	const targetTheme = isDark ? t("lightTheme") : t("darkTheme");
	const label = t("switchThemeAriaLabel", { theme: targetTheme });

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
			suppressHydrationWarning
			variant="invisible"
			disableRipple
			onPress={toggleTheme}
			aria-label={label}
			className="flex items-center justify-center gap-2"
		>
			{/* Sun icon for dark mode (click to switch to light) */}
			<IoMdSunny
				suppressHydrationWarning
				className={twMerge(
					"size-5 fill-accent transition-all",
					"dark:block hidden"
				)}
			/>
			{/* Moon icon for light mode (click to switch to dark) */}
			<HiOutlineMoon
				suppressHydrationWarning
				className={twMerge(
					"size-5 stroke-accent transition-all",
					"dark:hidden block"
				)}
			/>
			{/* Show label text in mobile menu */}
			{showLabel && (
				<span
					className={twMerge(
						"text-lg text-accent",
						styleVariant === "wide" ? "uppercase" : ""
					)}
				>
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
	);
}
