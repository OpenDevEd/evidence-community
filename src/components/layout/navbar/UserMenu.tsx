"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Logout01Icon, UserEdit01Icon, UserIcon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { Avatar, DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger } from "@nextui-org/react";
import { Dropdown } from "@/components/nextui/Dropdown";
import OpenScholar from "@/components/icons/OpenScholar";
import { useRouter } from "@/i18n/routing";
import { twMerge } from "@/lib/tw-merge";
import type { NavbarElementProps } from "@/types/navbar";
import { OPENSCHOLAR_ACCOUNT_URL, useMockReaderSession, type MockReader } from "./MockReaderSession";

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
 * The signed-in reader's items: who they are, their profile, their
 * OpenScholar account and signing out. Shared by the avatar menu and the
 * condensed menu so the two never differ.
 */
export function readerMenuItems(input: {
	reader: MockReader;
	t: Translate;
	onProfile: () => void;
	onSignOut: () => void;
}) {
	const { reader, t } = input;
	const openAccount = () => window.open(OPENSCHOLAR_ACCOUNT_URL, "_blank", "noopener");
	const external = <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4 text-default-400" aria-hidden />;
	return [
		<DropdownItem
			key="reader"
			isReadOnly
			textValue={readerDisplayName(reader, t)}
			className="opacity-100 cursor-default data-[hover=true]:bg-transparent"
		>
			<span className="flex items-center gap-3 py-1">
				<ReaderAvatar reader={reader} size="sm" />
				<span className="min-w-0">
					<span className="block truncate font-semibold text-foreground">{readerDisplayName(reader, t)}</span>
					<span className="flex items-center gap-1 text-small text-default-500">
						<OpenScholar aria-hidden className="size-3.5" />
						{t("signedInWithOpenScholar")}
					</span>
				</span>
			</span>
		</DropdownItem>,
		...(reader.name.trim()
			? []
			: [
					<DropdownItem
						key="add-name"
						onPress={openAccount}
						startContent={<HugeiconsIcon icon={UserEdit01Icon} className="size-4 text-accent" />}
						endContent={external}
						className="text-accent"
					>
						{t("addYourName")}
					</DropdownItem>,
				]),
		<DropdownItem
			key="profile"
			onPress={input.onProfile}
			startContent={<HugeiconsIcon icon={UserIcon} className="size-4" />}
		>
			{t("profileMenuItem")}
		</DropdownItem>,
		<DropdownItem
			key="account"
			onPress={openAccount}
			startContent={<OpenScholar aria-hidden className="size-4" />}
			endContent={external}
		>
			{t("openScholarAccount")}
		</DropdownItem>,
		<DropdownItem
			key="logout"
			color="danger"
			onPress={input.onSignOut}
			startContent={<HugeiconsIcon icon={Logout01Icon} className="size-4" />}
			className="text-danger"
		>
			{t("signOut")}
		</DropdownItem>,
	];
}

export default function UserMenu({ variant }: NavbarElementProps) {
	const { reader, signOut } = useMockReaderSession();
	const router = useRouter();
	const t = useTranslations("ui");

	if (!reader) return null;

	const items = readerMenuItems({
		reader,
		t,
		onProfile: () => router.push(`/profile/${reader.id}`),
		onSignOut: signOut,
	});

	if (variant === "menuItem") return <>{items}</>;

	return (
		<Dropdown placement="bottom-end">
			<DropdownTrigger>
				<ReaderAvatar reader={reader} asTrigger />
			</DropdownTrigger>
			<DropdownMenu aria-label={t("userMenuAriaLabel")} className="p-1 min-w-60">
				<DropdownSection showDivider classNames={{ base: "mb-1" }}>
					{items.slice(0, 1)}
				</DropdownSection>
				<DropdownSection classNames={{ base: "mb-0" }}>{items.slice(1)}</DropdownSection>
			</DropdownMenu>
		</Dropdown>
	);
}
