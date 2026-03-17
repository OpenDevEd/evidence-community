"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import {
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
} from "@nextui-org/react";
import { ChevronDownIcon } from "@nextui-org/shared-icons";
import { useDisclosure } from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import { Dropdown } from "@/components/nextui/Dropdown";
import { useDebounce } from "@/hooks/useDebounce";
import { useGapMaps } from "@/context/Providers";
import { BsMapFill } from "react-icons/bs";
import type { NavbarStyleVariant } from "@/types/navbar";

interface GapMapLinksProps {
	pathname: string;
	isMobile: boolean;
	styleVariant: NavbarStyleVariant;
}

export default function GapMapLinks({
	pathname,
	isMobile,
	styleVariant,
}: GapMapLinksProps) {
	const t = useTranslations("nav");
	const tUI = useTranslations("ui");
	const gapmaps = useGapMaps();
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const [debouncedOnClose, timeoutRef] = useDebounce(onClose, 250);

	const clearTimeoutOpen = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}
		onOpen();
	}, [timeoutRef, onOpen]);

	if (!gapmaps.length) return null;

	const isActive = pathname.includes("/gapmap");
	const latest = gapmaps[gapmaps.length - 1];

	return (
		<li
			onMouseEnter={clearTimeoutOpen}
			onMouseLeave={debouncedOnClose}
			className={twMerge(
				"flex items-center gap-2 text-black/60 dark:text-white/60",
				isActive && "text-accent dark:text-accent"
			)}
		>
			<a
				href={latest.href}
				data-is-mobile={isMobile}
				className={twMerge(
					"flex gap-2 text-lg items-center justify-center font-medium",
					styleVariant === "wide" && "uppercase font-base"
				)}
			>
				<BsMapFill className={twMerge("fill-current size-6 shrink-0", styleVariant === "wide" && "size-5")} />
				<span className="line-clamp-1">{t("gapMaps")}</span>
			</a>

			<Dropdown
				color="accent"
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				offset={12}
			>
				<DropdownTrigger>
					<Button
						variant="invisible"
						className="relative text-current dark:text-current"
						aria-label={tUI("dropdownAriaLabel", { label: "Gap Maps" })}
					>
						<ChevronDownIcon className="size-4" />
					</Button>
				</DropdownTrigger>
				<DropdownMenu
					itemClasses={{
						base: "data-[hover]:bg-accent-400",
						title: "text-white",
					}}
				>
					{gapmaps.map((gm) => (
						<DropdownItem key={gm.slug} href={gm.href}>
							{gm.label}
						</DropdownItem>
					))}
				</DropdownMenu>
			</Dropdown>
		</li>
	);
}
