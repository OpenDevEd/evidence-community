"use client";

import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { IoIosLogIn } from "react-icons/io";
import { DropdownItem } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import type { NavbarElementProps } from "@/types/navbar";

export default function LoginButton({
	variant,
	styleVariant,
	onAction,
}: NavbarElementProps) {
	const t = useTranslations("ui");
	const isEnabled = useLibraryFeature("login");
	const { data: session } = useSession();

	// Don't render if login is disabled or user is already logged in
	if (!isEnabled || session) return null;

	// Menu item variant - for dropdowns
	if (variant === "menuItem") {
		return (
			<DropdownItem
				key="login"
				onPress={onAction}
				startContent={<IoIosLogIn className="size-5" />}
			>
				{t("login")}
			</DropdownItem>
		);
	}

	// Inline variant - button with style differences
	const isSmall = styleVariant === "small";

	return (
		<Button
			startContent={<IoIosLogIn className="size-5 shrink-0" />}
			onPress={onAction}
			isIconOnly={isSmall}
			className={twMerge(
				"text-accent dark:text-accent py-1",
				isSmall
					? "!p-0 rounded-full !size-10"
					: "!min-w-10 !px-0 sm:!min-w-24 sm:!px-4 uppercase"
			)}
			aria-label={t("loginButtonAriaLabel")}
		>
			{!isSmall && <span className="hidden sm:inline">{t("login")}</span>}
		</Button>
	);
}
