"use client";

import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowUpRight01Icon, Logout01Icon, UserEdit01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { Avatar, DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger } from "@nextui-org/react";
import { Dropdown } from "@/components/nextui/Dropdown";
import OpenScholar from "@/components/icons/OpenScholar";
import { useRouter } from "@/i18n/routing";
import { twMerge } from "@/lib/tw-merge";
import type { NavbarElementProps } from "@/types/navbar";
import { OPENSCHOLAR_ACCOUNT_URL, useMockReaderSession, type MockReader } from "./MockReaderSession";
import {
	NavbarMenuIcon,
	navbarMenuClasses,
	navbarMenuDropdownClasses,
	navbarMenuItemClasses,
	navbarMenuSectionClasses,
} from "./menuStyles";

type Translate = ReturnType<typeof useTranslations<"ui">>;

/** A reader without a name in OpenScholar shows as "Reader", never as their email. */
export function readerDisplayName(reader: MockReader, t: Translate) {
	return reader.name.trim() || t("readerFallbackName");
}

function initials(name: string) {
	return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

/** As the menu trigger it is the button itself, which is what the dropdown needs. */
export function ReaderAvatar({
	reader,
	size = "md",
	asTrigger = false,
	...triggerProps
}: { reader: MockReader; size?: "sm" | "md"; asTrigger?: boolean } & Omit<
	ComponentProps<typeof Avatar>,
	"size" | "as"
>) {
	const t = useTranslations("ui");
	return (
		<Avatar
			// The dropdown trigger hands its press handler and ref through here.
			{...triggerProps}
			as={asTrigger ? "button" : "span"}
			{...(asTrigger ? { "aria-label": t("userMenuAriaLabel") } : {})}
			size={size}
			getInitials={initials}
			src={reader.image ?? undefined}
			// A named reader shows initials; one without a name shows a person.
			name={reader.name.trim() || undefined}
			{...(reader.name.trim()
				? {}
				: {
						showFallback: true,
						fallback: <HugeiconsIcon icon={UserIcon} className="size-5 text-accent" aria-hidden />,
					})}
			alt={t("userAvatarAlt", { name: readerDisplayName(reader, t) })}
			classNames={{ base: twMerge("shrink-0 bg-accent/10 text-accent font-medium", asTrigger && "cursor-pointer") }}
		/>
	);
}

/**
 * The signed-in reader's rows, in the groups both header menus show them:
 * who is signed in, their account, and signing out.
 */
export function readerMenuGroups(input: {
	reader: MockReader;
	t: Translate;
	onProfile: () => void;
	onSignOut: () => void;
}) {
	const { reader, t } = input;
	const openAccount = () => window.open(OPENSCHOLAR_ACCOUNT_URL, "_blank", "noopener");
	const external = <NavbarMenuIcon icon={ArrowUpRight01Icon} className="size-4 text-foreground/40 dark:text-white/40" />;
	const name = readerDisplayName(reader, t);
	return {
		identity: (
			<DropdownItem
				key="reader"
				isReadOnly
				textValue={name}
				className="h-auto py-2 cursor-default data-[hover=true]:bg-transparent dark:data-[hover=true]:bg-transparent"
			>
				<span className="flex items-center gap-3">
					<ReaderAvatar reader={reader} size="sm" />
					<span className="min-w-0">
						<span className="block truncate text-medium font-semibold text-foreground dark:text-white">{name}</span>
						<span className="flex items-center gap-1.5 text-small text-foreground/60 dark:text-white/60">
							<OpenScholar monochrome aria-hidden className="size-3.5" />
							{t("signedInWithOpenScholar")}
						</span>
					</span>
				</span>
			</DropdownItem>
		),
		account: [
			...(reader.name.trim()
				? []
				: [
						<DropdownItem
							key="add-name"
							onPress={openAccount}
							startContent={<NavbarMenuIcon icon={UserEdit01Icon} />}
							endContent={external}
						>
							{t("addYourName")}
						</DropdownItem>,
					]),
			<DropdownItem key="profile" onPress={input.onProfile} startContent={<NavbarMenuIcon icon={UserIcon} />}>
				{t("profileMenuItem")}
			</DropdownItem>,
			<DropdownItem
				key="account"
				onPress={openAccount}
				startContent={<OpenScholar monochrome aria-hidden className="size-5 shrink-0 text-foreground/60 dark:text-white/60" />}
				endContent={external}
			>
				{t("openScholarAccount")}
			</DropdownItem>,
		],
		signOut: (
			<DropdownItem
				key="logout"
				onPress={input.onSignOut}
				startContent={<NavbarMenuIcon icon={Logout01Icon} className="text-danger dark:text-danger" />}
				className="text-danger dark:text-danger"
			>
				{t("signOut")}
			</DropdownItem>
		),
	};
}

export default function UserMenu({ variant }: NavbarElementProps) {
	const { reader, signOut } = useMockReaderSession();
	const router = useRouter();
	const t = useTranslations("ui");

	if (!reader) return null;

	const groups = readerMenuGroups({
		reader,
		t,
		onProfile: () => router.push(`/profile/${reader.id}`),
		onSignOut: signOut,
	});

	if (variant === "menuItem") return <>{[groups.identity, ...groups.account, groups.signOut]}</>;

	return (
		<Dropdown placement="bottom-end" classNames={navbarMenuDropdownClasses}>
			<DropdownTrigger>
				<ReaderAvatar reader={reader} asTrigger />
			</DropdownTrigger>
			<DropdownMenu aria-label={t("userMenuAriaLabel")} classNames={navbarMenuClasses} itemClasses={navbarMenuItemClasses}>
				<DropdownSection showDivider classNames={navbarMenuSectionClasses}>
					{groups.identity}
				</DropdownSection>
				<DropdownSection showDivider classNames={navbarMenuSectionClasses}>
					{groups.account}
				</DropdownSection>
				<DropdownSection classNames={navbarMenuSectionClasses}>{groups.signOut}</DropdownSection>
			</DropdownMenu>
		</Dropdown>
	);
}
