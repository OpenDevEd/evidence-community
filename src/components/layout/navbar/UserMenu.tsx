"use client";

import { useTranslations } from "next-intl";
import { useClerk } from "@clerk/nextjs";
import { User, LogOut } from "lucide-react";
import {
	Avatar,
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
} from "@heroui/react";
import { Dropdown } from "@/components/heroui/Dropdown";
import { useRouter } from "@/i18n/routing";
import type { NavbarElementProps } from "@/types/navbar";
import { useNavbarAuthState } from "./useNavbarAuthState";

export default function UserMenu({
	variant,
	styleVariant: _styleVariant,
}: NavbarElementProps) {
	const { signOut } = useClerk();
	const router = useRouter();
	const t = useTranslations("ui");
	const {
		hasResolvedIdentity,
		isAuthPending,
		isLoaded,
		isSignedIn,
		profileHref,
		session,
		user,
	} = useNavbarAuthState();

	if (isAuthPending) {
		return (
			<div
				aria-hidden="true"
				className="size-10 rounded-full animate-pulse bg-zinc-300/90 ring-1 ring-zinc-400/60 dark:bg-zinc-200/30 dark:ring-zinc-100/60"
			/>
		);
	}

	if (!isLoaded || !isSignedIn) return null;

	const userName =
		user?.fullName ||
		user?.primaryEmailAddress?.emailAddress ||
		session?.user?.name ||
		session?.user?.email ||
		t("genericUser");
	const userImage = user?.imageUrl ?? session?.user?.image ?? "/icons/profile.png";
	const handleAction = (key: React.Key) => {
		if (key === "logout") {
			void signOut();
		} else if (key === "profile") {
			router.push(profileHref);
		}
	};

	// Menu item variant - returns dropdown items for profile and logout
	if (variant === "menuItem") {
		return (
			<>
				<DropdownItem
					key="profile"
					onPress={() => router.push(profileHref)}
					startContent={<User className="size-4" />}
				>
					{t("profileMenuItem")}
				</DropdownItem>
				<DropdownItem
					key="logout"
					color="danger"
					onPress={() => {
						void signOut();
					}}
					startContent={<LogOut className="size-4" />}
					className="text-danger"
				>
					{t("logout")}
				</DropdownItem>
			</>
		);
	}

	// Keep avatar footprint stable while Clerk/session payload resolves.
	if (!hasResolvedIdentity) {
		return (
			<div
				aria-hidden="true"
				className="size-10 rounded-full animate-pulse bg-zinc-300/90 ring-1 ring-zinc-400/60 dark:bg-zinc-200/30 dark:ring-zinc-100/60"
			/>
		);
	}

	// Inline variant - avatar with dropdown (restored original behavior)
	return (
		<Dropdown>
			<DropdownTrigger>
				<Avatar
					as="button"
					className="size-10 cursor-pointer transition-transform"
					aria-label={t("actionsMenuAriaLabel")}
					src={userImage}
					alt={t("userAvatarAlt", { name: userName })}
				/>
			</DropdownTrigger>
			<DropdownMenu onAction={handleAction} aria-label={t("actionsMenuAriaLabel")}>
				<DropdownItem key="profile" startContent={<User className="size-4" />}>
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
			</DropdownMenu>
		</Dropdown>
	);
}
