"use client";

import { useTranslations } from "next-intl";
import { DropdownItem } from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import OpenScholar from "@/components/icons/OpenScholar";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useMockReaderSession } from "./MockReaderSession";
import type { NavbarElementProps } from "@/types/navbar";

/** Starts signing in with the reader's OpenScholar account. Shown only on press. */
export default function LoginButton({ variant }: NavbarElementProps) {
	const t = useTranslations("ui");
	const isEnabled = useLibraryFeature("login");
	const { reader, signIn } = useMockReaderSession();

	if (!isEnabled || reader) return null;

	const label = t("signInWithOpenScholar");
	const logo = <OpenScholar aria-hidden className="size-5 shrink-0" />;

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
					isIconOnly
					aria-label={label}
					className="sm:hidden !p-0 rounded-full !size-10"
				>
					{logo}
				</Button>
			</Tooltip>
			<Button
				onPress={signIn}
				startContent={logo}
				className="hidden sm:inline-flex h-10 !px-4 font-medium text-foreground"
			>
				{label}
			</Button>
		</>
	);
}
