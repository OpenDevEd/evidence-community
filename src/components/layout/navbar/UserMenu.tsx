"use client";

import { useTranslations } from "next-intl";
import { useSession, signOut } from "next-auth/react";
import { User, LogOut } from "lucide-react";
import {
	Avatar,
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
} from "@nextui-org/react";
import { Dropdown } from "@/components/nextui/Dropdown";
import { useRouter } from "@/i18n/routing";
import type { NavbarElementProps } from "@/types/navbar";

export default function UserMenu({ variant, styleVariant }: NavbarElementProps) {
	const { data: session } = useSession();
	const router = useRouter();
	const t = useTranslations("ui");

	// Don't render if user is not logged in
	if (!session) return null;

	const userName =
		session.user?.name || session.user?.email || t("genericUser");
	const userImage = session.user?.image ?? "/icons/profile.png";

	const handleAction = (key: React.Key) => {
		if (key === "logout") {
			signOut({ redirect: false });
		} else if (key === "profile") {
			router.push(`/profile/${session.user?.id}`);
		}
	};

	// Menu item variant - returns dropdown items for profile and logout
	if (variant === "menuItem") {
		return (
			<>
				<DropdownItem
					key="profile"
					onPress={() => router.push(`/profile/${session.user?.id}`)}
					startContent={<User className="size-4" />}
				>
					{t("profileMenuItem")}
				</DropdownItem>
				<DropdownItem
					key="logout"
					color="danger"
					onPress={() => signOut({ redirect: false })}
					startContent={<LogOut className="size-4" />}
					className="text-danger"
				>
					{t("logout")}
				</DropdownItem>
			</>
		);
	}

	// Inline variant - Avatar with dropdown
	return (
		<Dropdown>
			<DropdownTrigger>
				<Avatar
					as="button"
					className="cursor-pointer transition-transform"
					src={userImage}
					alt={t("userAvatarAlt", { name: userName })}
				/>
			</DropdownTrigger>
			<DropdownMenu onAction={handleAction} aria-label={t("userMenuAriaLabel")}>
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
