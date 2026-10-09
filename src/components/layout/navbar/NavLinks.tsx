"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
import { DropdownItem, DropdownMenu, DropdownTrigger } from "@nextui-org/react";
import { ChevronDownIcon } from "@nextui-org/shared-icons";
import { useDisclosure } from "@nextui-org/react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/nextui/Button";
import { Dropdown } from "@/components/nextui/Dropdown";
import { useDebounce } from "@/hooks/useDebounce";
import { localizeOrUseIfCapitalized } from "@/lib/utils";
import { useGapMaps } from "@/context/Providers";
import GapMapLinks from "./GapMapLinks";
import type { NavbarStyleVariant } from "@/types/navbar";
import { RuntimeAsset } from "@/components/library/RuntimeAsset";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import {
	getRuntimeInternalHrefPath,
	getRuntimeLinkAnchorProps,
	getVisibleRuntimeLinks,
	type RuntimeNavigationLink,
} from "@/config/library-config/links";

interface LinkItemProps {
	link: RuntimeNavigationLink;
	pathname: string;
	isMobile: boolean;
	styleVariant: NavbarStyleVariant;
	onNavigate?: () => void;
}

function isActiveHref(pathname: string, href: string) {
	const activeHrefPath = getRuntimeInternalHrefPath(href);
	if (!activeHrefPath) return false;

	return `${pathname}/`.includes(`${activeHrefPath}/`);
}
function LinkItem({ link, pathname, isMobile, styleVariant, onNavigate }: LinkItemProps) {
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
	const visibleChildren = getVisibleRuntimeLinks(link.children);
	return (
		<li
			onMouseEnter={isMobile ? undefined : clearTimeoutOpen}
			onMouseLeave={isMobile ? undefined : debouncedOnClose}
			className={twMerge(
				"flex items-center gap-2 text-black/60 dark:text-white/60",
				isActive && "text-accent dark:text-accent"
			)}
		>
			<Link
				href={link.href}
				onNavigate={onNavigate}
				{...getRuntimeLinkAnchorProps(link)}
				data-is-mobile={isMobile}
				className={twMerge(
					"flex gap-2 text-lg items-center justify-center font-medium",
					styleVariant === "wide" && "font-base"
				)}
			>
				{link.icon && (
					<RuntimeAsset
						reference={link.icon}
						alt=""
						className={twMerge(
							"size-6 shrink-0",
							styleVariant === "wide" && "size-5"
						)}
					/>
				)}
				<span className="line-clamp-1">
					{localizeOrUseIfCapitalized(link.label, t)}
				</span>
			</Link>

			{visibleChildren.length > 0 && (
				<Dropdown color="accent" isOpen={isOpen} onOpenChange={onOpenChange} offset={12}>
					<DropdownTrigger>
						<Button
							variant="invisible"
							className="relative text-current dark:text-current"
							aria-label={tUI("dropdownAriaLabel", { label: localizeOrUseIfCapitalized(link.label, t) })}
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
						{visibleChildren.map((child) => {
							return (
								<DropdownItem
									key={child.id}
									href={child.href}
									onAction={onNavigate}
									{...getRuntimeLinkAnchorProps(child)}
									startContent={
										child.icon ? (
											<RuntimeAsset
												reference={child.icon}
												alt=""
												className="size-4"
											/>
										) : undefined
									}
								>
									{localizeOrUseIfCapitalized(child.label, t)}
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
	onNavigate?: () => void;
}

export function useNavigationLinks() {
	const { navigation } = useLibraryConfig();
	const gapmaps = useGapMaps();
	const links = getVisibleRuntimeLinks(navigation.links);
	return { links, hasLinks: links.length > 0 || gapmaps.length > 0 };
}

export default function NavLinks({
	pathname,
	isMobile = false,
	styleVariant = "small",
	onNavigate,
}: NavLinksProps) {
	const { links, hasLinks } = useNavigationLinks();
	if (!hasLinks) return null;

	return (
		<ul
			className={twMerge(
				"flex items-center justify-end gap-6",
				isMobile && "flex-col gap-8 px-8",
				!isMobile && "nf-links"
			)}
		>
			{links.map((link) => (
				<LinkItem
					key={link.id}
					link={link}
					pathname={pathname}
					isMobile={isMobile}
					styleVariant={styleVariant}
					onNavigate={onNavigate}
				/>
			))}
			<GapMapLinks
				pathname={pathname}
				isMobile={isMobile}
				styleVariant={styleVariant}
					onNavigate={onNavigate}
			/>
		</ul>
	);
}
