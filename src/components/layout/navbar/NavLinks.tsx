"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { DropdownItem, DropdownMenu, DropdownTrigger } from "@nextui-org/react";
import { ChevronDownIcon } from "@nextui-org/shared-icons";
import { useDisclosure } from "@nextui-org/react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/nextui/Button";
import { Dropdown } from "@/components/nextui/Dropdown";
import { useDebounce } from "@/hooks/useDebounce";
import { useStatus } from "@/context/Providers";
import { NAVBAR_ICONS } from "@/constants/links";
import { localizeOrUseIfCapitalized } from "@/lib/utils";
import { style } from "@/../tailwind.config";
import type { LinkObject } from "@/db/schema/tables/status";
import GapMapLinks from "./GapMapLinks";
import type { NavbarStyleVariant } from "@/types/navbar";

interface LinkItemProps {
	link: LinkObject;
	pathname: string;
	isMobile: boolean;
	styleVariant: NavbarStyleVariant;
}


/** Labels this short never truncate. */
const SHORT_LABEL = 12;

function getActiveHrefPath(href: string) {
	if (href.startsWith("http://") || href.startsWith("https://")) {
		try {
			return new URL(href).pathname || "/";
		} catch {
			return href;
		}
	}

	const queryIndex = href.indexOf("?");
	const hashIndex = href.indexOf("#");
	const endIndex =
		queryIndex === -1
			? hashIndex
			: hashIndex === -1
				? queryIndex
				: Math.min(queryIndex, hashIndex);

	return endIndex === -1 ? href : href.slice(0, endIndex);
}

function isActiveHref(pathname: string, href: string) {
	const activeHrefPath = getActiveHrefPath(href);

	return `${pathname}/`.includes(`${activeHrefPath}/`);
}
function LinkItem({ link, pathname, isMobile, styleVariant }: LinkItemProps) {
	const t = useTranslations("nav");
	const tUI = useTranslations("ui");
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const [debouncedOnClose, timeoutRef] = useDebounce(onClose, 250);

	const clearTimeoutOpen = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}
		onOpen();
	}, [timeoutRef, onOpen]);

	const isActive = isActiveHref(pathname, link.href);
	const label = localizeOrUseIfCapitalized(link.label, t);
	const IconComponent = link.icon
		? NAVBAR_ICONS[link.icon as keyof typeof NAVBAR_ICONS]
		: null;

	return (
		<li
			onMouseEnter={clearTimeoutOpen}
			onMouseLeave={debouncedOnClose}
			className={twMerge(
				"flex min-w-0 items-center gap-2 text-black/60 dark:text-white/60",
				// Short labels keep their width; the long ones give way when the row is tight.
				label.length <= SHORT_LABEL && "shrink-0",
				isActive && "text-accent dark:text-accent"
			)}
		>
			<Link
				href={link.href}
				data-is-mobile={isMobile}
				className={twMerge(
					"flex min-w-0 gap-2 text-lg items-center justify-center font-medium",
					styleVariant === "wide" && "uppercase font-base"
				)}
			>
				{IconComponent && (
					<IconComponent
						data-is-mobile={isMobile}
						aria-label={tUI("dropdownAriaLabel", {
							label: localizeOrUseIfCapitalized(link.label, t),
						})}
						className={twMerge(
							"fill-current size-6 shrink-0",
							styleVariant === "wide" && "size-5"
						)}
					/>
				)}
				<span className="min-w-0 truncate">{label}</span>
			</Link>

			{link.dropdown && link.dropdown.length > 0 && (
				<Dropdown color="accent" isOpen={isOpen} onOpenChange={onOpenChange} offset={12}>
					<DropdownTrigger>
						<Button
							variant="invisible"
							className="relative text-current dark:text-current"
							aria-label={tUI("dropdownAriaLabel", { label: link.label })}
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
						{link.dropdown.map((child: any) => {
							const ChildIcon = child.icon
								? NAVBAR_ICONS[child.icon as keyof typeof NAVBAR_ICONS]
								: null;
							return (
								<DropdownItem
									key={child.label}
									href={child.href}
									startContent={
										ChildIcon ? <ChildIcon className="size-4" /> : undefined
									}
								>
									{t(child.label)}
								</DropdownItem>
							);
						})}
					</DropdownMenu>
				</Dropdown>
			)}
		</li>
	);
}

interface NavLinksProps {
	pathname: string;
	isMobile?: boolean;
	styleVariant?: NavbarStyleVariant;
}

export default function NavLinks({
	pathname,
	isMobile = false,
	styleVariant = (style as NavbarStyleVariant) || "small",
}: NavLinksProps) {
	const status = useStatus();
	const links: LinkObject[] = status.links || [];

	return (
		<ul
			className={twMerge(
				"flex items-center justify-end gap-6",
				isMobile && "flex-col gap-8 px-8",
				!isMobile && "hidden xl:flex"
			)}
		>
			{links.map(
				(link, index) =>
					!link.navExclude && (
						<LinkItem
							key={index}
							link={link}
							pathname={pathname}
							isMobile={isMobile}
							styleVariant={styleVariant}
						/>
					)
			)}
			<GapMapLinks
				pathname={pathname}
				isMobile={isMobile}
				styleVariant={styleVariant}
			/>
		</ul>
	);
}
