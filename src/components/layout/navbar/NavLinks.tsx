"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import { getLangDir } from "rtl-detect";
import { twMerge } from "@/lib/tw-merge";
import { DropdownItem, DropdownMenu, DropdownTrigger } from "@nextui-org/react";
import { ChevronDownIcon } from "@nextui-org/shared-icons";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/nextui/Button";
import { Dropdown } from "@/components/nextui/Dropdown";
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
	type RuntimeLeafLink,
	type RuntimeNavigationLink,
} from "@/config/library-config/links";

interface LinkItemProps {
	link: RuntimeNavigationLink;
	pathname: string;
	styleVariant: NavbarStyleVariant;
	onNavigate?: () => void;
}

function isActiveHref(pathname: string, href: string) {
	const activeHrefPath = getRuntimeInternalHrefPath(href);
	if (!activeHrefPath) return false;

	return `${pathname}/`.includes(`${activeHrefPath}/`);
}

function linkItemClassName(pathname: string, href: string) {
	return twMerge(
		"flex items-center gap-2 text-black/60 dark:text-white/60",
		isActiveHref(pathname, href) && "text-accent dark:text-accent"
	);
}

function LinkLabel({
	link,
	isMobile,
	styleVariant,
	onNavigate,
}: Omit<LinkItemProps, "pathname"> & { isMobile: boolean }) {
	const t = useTranslations("nav");
	return (
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
	);
}

function SubmenuLinkIcon({ link }: { link: RuntimeLeafLink }) {
	return link.icon ? <RuntimeAsset reference={link.icon} alt="" className="size-4" /> : null;
}

/** The phone menu has no hover: its submenus open on a press. */
function MobileLinkItem({ link, pathname, styleVariant, onNavigate }: LinkItemProps) {
	const t = useTranslations("nav");
	const tUI = useTranslations("ui");
	const visibleChildren = getVisibleRuntimeLinks(link.children);
	return (
		<li className={linkItemClassName(pathname, link.href)}>
			<LinkLabel link={link} isMobile styleVariant={styleVariant} onNavigate={onNavigate} />

			{visibleChildren.length > 0 && (
				<Dropdown color="accent" offset={12}>
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
						{visibleChildren.map((child) => (
							<DropdownItem
								key={child.id}
								href={child.href}
								onAction={onNavigate}
								{...getRuntimeLinkAnchorProps(child)}
								startContent={<SubmenuLinkIcon link={child} />}
							>
								{localizeOrUseIfCapitalized(child.label, t)}
							</DropdownItem>
						))}
					</DropdownMenu>
				</Dropdown>
			)}
		</li>
	);
}

const WINDOW_MARGIN = 12;
const FOCUS_RING = "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * Places a panel below its chevron at full size, centred unless that would put it past the edge of the window. The header
 * can be scaled down over some pages and beside the chat, and the panel sits inside it, so it undoes that scale.
 */
function placePanel(panel: HTMLElement, chevron: HTMLElement) {
	const box = chevron.getBoundingClientRect();
	panel.style.zoom = String(chevron.offsetWidth / box.width);
	const half = panel.offsetWidth / 2;
	const centre = box.left + box.width / 2;
	const overRight = centre + half + WINDOW_MARGIN - document.documentElement.clientWidth;
	const overLeft = WINDOW_MARGIN - (centre - half);
	panel.style.setProperty("--panel-shift", `${overLeft > 0 ? overLeft : Math.min(0, -overRight)}px`);
}

/** The window's size is the outside system here: a menu left open with the keyboard follows a resize. */
function keepPanelPlaced(panel: HTMLElement | null) {
	const chevron = panel?.parentElement;
	if (!panel || !chevron) return;
	const place = () => placePanel(panel, chevron);
	place();
	window.addEventListener("resize", place);
	return () => window.removeEventListener("resize", place);
}

function SubmenuPanel({ links }: { links: RuntimeLeafLink[] }) {
	const t = useTranslations("nav");
	return (
		// The top padding is the 12px gap below the chevron. It is part of the panel, so the pointer never leaves it on the way down.
		<NavigationMenu.Content
			ref={keepPanelPlaced}
			className="absolute top-full left-1/2 z-10 w-max origin-top pt-3 [translate:calc(-50%+var(--panel-shift,0px))_0] animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none"
		>
			<ul className="flex min-w-[200px] flex-col gap-0.5 rounded-2xl border-small border-transparent bg-accent p-2 text-small text-white shadow-medium">
				{links.map((child) => (
					<li key={child.id}>
						<NavigationMenu.Link asChild>
							<Link
								href={child.href}
								{...getRuntimeLinkAnchorProps(child)}
								className={twMerge("flex items-center gap-2 rounded-small px-2 py-1.5 text-white hover:bg-accent-400", FOCUS_RING)}
							>
								<SubmenuLinkIcon link={child} />
								{localizeOrUseIfCapitalized(child.label, t)}
							</Link>
						</NavigationMenu.Link>
					</li>
				))}
			</ul>
		</NavigationMenu.Content>
	);
}

type RowPointerProps = Pick<ComponentPropsWithoutRef<"div">, "onPointerEnter" | "onPointerMove" | "onPointerLeave">;
type SubmenuTriggerProps = Omit<ComponentPropsWithoutRef<"button">, keyof RowPointerProps> &
	RowPointerProps & { label: ReactNode; panel: ReactNode };

/**
 * Radix gives its trigger the hover handlers and the button's other props together. The handlers go on the whole row, so
 * pointing at the link's text opens the menu as well as pointing at the chevron, while only the chevron is the button: the
 * text stays a link.
 */
const SubmenuTrigger = forwardRef<HTMLButtonElement, SubmenuTriggerProps>(function SubmenuTrigger(
	{ label, panel, onPointerEnter, onPointerMove, onPointerLeave, ...button },
	ref,
) {
	return (
		<div
			className="flex items-center gap-2"
			onPointerEnter={onPointerEnter}
			onPointerMove={onPointerMove}
			onPointerLeave={onPointerLeave}
		>
			{label}
			<span className="relative flex">
				<button ref={ref} type="button" className={twMerge("flex rounded-small text-current hover:opacity-80", FOCUS_RING)} {...button}>
					<ChevronDownIcon className="size-4" />
				</button>
				{panel}
			</span>
		</div>
	);
});

function DesktopLinkItem({ link, pathname, styleVariant }: LinkItemProps) {
	const t = useTranslations("nav");
	const tUI = useTranslations("ui");
	const visibleChildren = getVisibleRuntimeLinks(link.children);
	const label = <LinkLabel link={link} isMobile={false} styleVariant={styleVariant} />;
	return (
		<NavigationMenu.Item value={link.id} className={linkItemClassName(pathname, link.href)}>
			{visibleChildren.length > 0 ? (
				<NavigationMenu.Trigger asChild>
					<SubmenuTrigger
						label={label}
						panel={<SubmenuPanel links={visibleChildren} />}
						aria-label={tUI("dropdownAriaLabel", { label: localizeOrUseIfCapitalized(link.label, t) })}
					/>
				</NavigationMenu.Trigger>
			) : (
				label
			)}
		</NavigationMenu.Item>
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
	const dir = getLangDir(useLocale());
	if (!hasLinks) return null;

	const gapMapLinks = (
		<GapMapLinks pathname={pathname} isMobile={isMobile} styleVariant={styleVariant} onNavigate={onNavigate} />
	);

	if (isMobile) {
		return (
			<ul className="flex flex-col items-center justify-end gap-8 px-8">
				{links.map((link) => (
					<MobileLinkItem
						key={link.id}
						link={link}
						pathname={pathname}
						styleVariant={styleVariant}
						onNavigate={onNavigate}
					/>
				))}
				{gapMapLinks}
			</ul>
		);
	}

	return (
		// The header already wraps this in its labelled nav, so Radix's own landmark and its "Main" label stay out.
		<NavigationMenu.Root asChild dir={dir} aria-label={undefined}>
			<div>
				<NavigationMenu.List className="nf-links flex items-center justify-end gap-6">
					{links.map((link) => (
						<DesktopLinkItem
							key={link.id}
							link={link}
							pathname={pathname}
							styleVariant={styleVariant}
						/>
					))}
					{gapMapLinks}
				</NavigationMenu.List>
			</div>
		</NavigationMenu.Root>
	);
}
