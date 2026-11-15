"use client";

import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowUpRight01Icon, CheckmarkCircle02Icon, DashboardSquare01Icon, InboxIcon, Logout01Icon, UserAdd01Icon, UserEdit01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { openSuggestPapers } from "@/components/features/suggest/SuggestPapers";
import { useTranslations } from "next-intl";
import { Avatar, DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger } from "@nextui-org/react";
import { Dropdown } from "@/components/nextui/Dropdown";
import OpenScholar from "@/components/icons/OpenScholar";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useRouter } from "@/i18n/routing";
import { twMerge } from "@/lib/tw-merge";
import type { NavbarElementProps } from "@/types/navbar";
import { useReaderLinks, useReaderSession, type Reader, type ReaderLinks } from "./ReaderSession";
import {
	NavbarMenuIcon,
	navbarMenuClasses,
	navbarMenuDropdownClasses,
	navbarMenuItemClasses,
	navbarMenuSectionClasses,
} from "./menuStyles";

type Translate = ReturnType<typeof useTranslations<"ui">>;

/** A reader without a name in OpenScholar shows as "Reader", never as their email. */
export function readerDisplayName(reader: Reader, t: Translate) {
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
}: { reader: Reader; size?: "sm" | "md" | "lg"; asTrigger?: boolean } & Omit<
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
	reader: Reader;
	t: Translate;
	/** Their OpenScholar account page, where they change their name, avatar and sign-in settings; Admin for its team, Join this team for anyone else. */
	links: ReaderLinks;
	/** Absent when the library has no reader profiles, as for an admin of a library with reader accounts off. */
	onProfile?: () => void;
	onSignOut: () => void;
}) {
	const { reader, t } = input;
	const openAccount = () => window.open(input.links.accountUrl, "_blank", "noopener");
	const external = <NavbarMenuIcon icon={ArrowUpRight01Icon} className="ms-auto size-4 text-foreground/40 dark:text-white/40" />;
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
					<span className="flex shrink-0 self-start"><ReaderAvatar reader={reader} size="sm" /></span>
					<span className="min-w-0">
						<span className="block truncate text-medium font-semibold text-foreground dark:text-white">{name}</span>
						<span className="mt-0.5 flex items-center gap-1 text-tiny text-foreground/45 dark:text-white/40">
							<OpenScholar monochrome aria-hidden className="size-3" />
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
			...(input.onProfile
				? [
						<DropdownItem key="profile" onPress={input.onProfile} startContent={<NavbarMenuIcon icon={UserIcon} />}>
							{t("profileMenuItem")}
						</DropdownItem>,
					]
				: []),
			// The team has Admin. Anyone else joins, or sees their application was sent; nothing while the community takes none.
			...(input.links.admin
				? [
						<DropdownItem key="admin" href="/admin" startContent={<NavbarMenuIcon icon={DashboardSquare01Icon} />}>
							{t("adminMenuItem")}
						</DropdownItem>,
					]
				: input.links.join === "closed"
					? []
					: [
							<DropdownItem
								key="join"
								onPress={input.links.openJoin}
								startContent={<NavbarMenuIcon icon={input.links.join === "waiting" ? CheckmarkCircle02Icon : UserAdd01Icon} />}
								endContent={external}
							>
								{t(input.links.join === "waiting" ? "applicationSent" : "joinThisTeam")}
							</DropdownItem>,
						]),
			// Papers sent to this community's review queue (#777).
			<DropdownItem key="suggest" onPress={openSuggestPapers} startContent={<NavbarMenuIcon icon={InboxIcon} />}>
				{input.t("suggestPapers")}
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
	const { reader, signOut } = useReaderSession();
	const router = useRouter();
	const t = useTranslations("ui");
	const hasProfiles = useLibraryFeature("readerAccounts");
	const links = useReaderLinks();

	if (!reader) return null;

	const groups = readerMenuGroups({
		reader,
		t,
		links,
		onProfile: hasProfiles ? () => router.push(`/profile/${reader.id}`) : undefined,
		onSignOut: signOut,
	});

	if (variant === "menuItem") return <>{[groups.identity, ...groups.account, groups.signOut]}</>;

	return (
		// Opening it asks again whether they're on the team: an application accepted since the page loaded shows Admin.
		<Dropdown placement="bottom-end" classNames={navbarMenuDropdownClasses} onOpenChange={(open) => { if (open) links.refreshTeam(); }}>
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
