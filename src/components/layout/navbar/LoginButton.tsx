"use client";

import { useTranslations } from "next-intl";
import { DropdownItem } from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Login01Icon } from "@hugeicons/core-free-icons";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useReaderSession } from "./ReaderSession";
import type { NavbarElementProps } from "@/types/navbar";

/** Starts signing in with the reader's OpenScholar account, only when pressed. */
export default function LoginButton({ variant }: NavbarElementProps) {
	const t = useTranslations("ui");
	const isEnabled = useLibraryFeature("readerAccounts");
	const { reader, signIn } = useReaderSession();

	if (!isEnabled || reader) return null;

	const label = t("signIn");
	const logo = <HugeiconsIcon icon={Login01Icon} aria-hidden className="size-5 shrink-0" />;

	if (variant === "menuItem") {
		return (
			<DropdownItem key="login" onPress={signIn} startContent={logo}>
				{label}
			</DropdownItem>
		);
	}

	// Narrow phones have room for the logo only, so that button carries a
	// tooltip; everywhere else the label is visible and needs none.
	return (
		<>
			<Tooltip content={label}>
				<Button
					onPress={signIn}
					color="accent"
					isIconOnly
					aria-label={label}
					className="sm:hidden !p-0 rounded-full !size-10"
				>
					{logo}
				</Button>
			</Tooltip>
			<Button
				onPress={signIn}
				color="accent"
				startContent={logo}
				className="hidden sm:inline-flex h-10 !px-4 font-medium"
			>
				{label}
			</Button>
		</>
	);
}
