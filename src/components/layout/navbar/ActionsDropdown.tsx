"use client";

import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { GiHamburgerMenu } from "react-icons/gi";
import {
	Avatar,
	DropdownItem,
	DropdownMenu,
	DropdownSection,
	DropdownTrigger,
} from "@heroui/react";
import { Dropdown } from "@/components/heroui/Dropdown";
import { Button } from "@/components/heroui/Button";
import { useSortedLocales } from "@/hooks/useSortedLocales";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { useRouter, usePathname } from "@/i18n/routing";
import { signOut } from "next-auth/react";
import { IoIosLogIn } from "react-icons/io";
import { User, LogOut } from "lucide-react";
import ThemeSwitcher from "./ThemeSwitcher";
import LoginButton from "./LoginButton";
import LanguageSwitcher from "./LanguageSwitcher";
import type { NavbarContext } from "@/types/navbar";

interface ActionsDropdownProps {
	context: NavbarContext;
}

export default function ActionsDropdown({ context }: ActionsDropdownProps) {
	const t = useTranslations("ui");
	const { data: session } = useSession();
	const router = useRouter();
	const pathname = usePathname();
	const { sortedLocales, localesNames } = useSortedLocales();

	const isThemeEnabled = useFeatureFlagEnabled("theme-switcher");
	const isLanguageEnabled = useFeatureFlagEnabled("language-switcher");
	const isLoginEnabled = useFeatureFlagEnabled("login");

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
		if (sortedLocales.includes(keyStr)) {
			router.push(pathname, { locale: keyStr });
			return;
		}

		switch (keyStr) {
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
			<GiHamburgerMenu className="size-5 fill-accent" />
		</Button>
	);

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
						<ThemeSwitcher
							variant="menuItem"
							styleVariant={context.styleVariant}
						/>
					) : (
						<DropdownItem key="theme-placeholder" className="hidden">
							{" "}
						</DropdownItem>
					)}
					{hasLogin ? (
						<DropdownItem
							key="login"
							startContent={<IoIosLogIn className="size-5" />}
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
								startContent={<User className="size-4" />}
							>
								{t("profileMenuItem")}
							</DropdownItem>
							<DropdownItem
								key="logout"
								color="danger"
								startContent={<LogOut className="size-4" />}
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
