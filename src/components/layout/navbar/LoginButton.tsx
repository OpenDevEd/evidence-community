"use client";

import { useTranslations } from "next-intl";
import { useClerk } from "@clerk/nextjs";
import { IoIosLogIn } from "react-icons/io";
import { DropdownItem } from "@heroui/react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/heroui/Button";
import { useFeatureFlagEnabled } from "@/context/Providers";
import type { NavbarElementProps } from "@/types/navbar";
import { useNavbarAuthState } from "./useNavbarAuthState";

export default function LoginButton({
	variant,
	styleVariant,
}: NavbarElementProps) {
	const t = useTranslations("ui");
	const isEnabled = useFeatureFlagEnabled("login");
	const { openSignIn } = useClerk();
	const { isLoaded, isSignedIn } = useNavbarAuthState();
	const openSignInSafely = () => {
		if (!isLoaded || isSignedIn) {
			return;
		}

		try {
			openSignIn();
		} catch (error: any) {
			const code = error?.errors?.[0]?.code;
			if (code !== "cannot_render_single_session_enabled") {
				throw error;
			}
		}
	};

	if (!isEnabled || !isLoaded || isSignedIn) return null;

	// Menu item variant - for dropdowns
	if (variant === "menuItem") {
		return (
			<DropdownItem
				key="login"
				onPress={() => {
					openSignInSafely();
				}}
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
			onPress={() => {
				openSignInSafely();
			}}
			isIconOnly={isSmall}
			className={twMerge(
				"text-accent dark:text-accent py-1",
				isSmall ? "!p-0 rounded-full !size-10" : "uppercase"
			)}
			aria-label={t("loginButtonAriaLabel")}
		>
			{!isSmall && t("login")}
		</Button>
	);
}
