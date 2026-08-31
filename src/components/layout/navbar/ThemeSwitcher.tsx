"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { DropdownItem } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import type { NavbarElementProps } from "@/types/navbar";

const subscribeToHydration = () => () => {};

type ThemeSwitcherProps = NavbarElementProps & {
	toolbar?: boolean;
};

export default function ThemeSwitcher({
	variant,
	styleVariant,
	showLabel,
	toolbar = false,
}: ThemeSwitcherProps) {
	const mounted = useSyncExternalStore(
		subscribeToHydration,
		() => true,
		() => false,
	);
	const { resolvedTheme, setTheme } = useTheme();
	const isEnabled = useLibraryFeature("themeSwitcher");
	const t = useTranslations("ui");

	if (!isEnabled) return null;

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
						<HugeiconsIcon icon={Sun03Icon} className="size-5 text-accent" />
					) : (
						<HugeiconsIcon icon={Moon02Icon} className="size-5 text-accent" />
					)
				}
			>
				{label}
			</DropdownItem>
		);
	}

	// Inline variant - standalone button
	const button = (
		<Button
			aria-label={label}
			className={twMerge(
				"flex items-center justify-center gap-2",
				toolbar &&
					"h-10 min-h-10 w-10 rounded-xl text-black/45 hover:bg-black/[0.05] hover:text-black/80 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/80",
			)}
			disableRipple
			isIconOnly={toolbar}
			onPress={toggleTheme}
			size={toolbar ? "xs" : undefined}
			variant={toolbar ? "transparent" : "invisible"}
		>
			<HugeiconsIcon icon={Sun03Icon}
				className={twMerge(
					toolbar ? "size-4" : "size-5",
					"text-accent transition-all",
					"dark:block hidden"
				)}
			/>
			<HugeiconsIcon icon={Moon02Icon}
				className={twMerge(
					toolbar ? "size-4" : "size-5",
					"text-accent transition-all",
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

	return toolbar ? <Tooltip content={label}>{button}</Tooltip> : button;
}
