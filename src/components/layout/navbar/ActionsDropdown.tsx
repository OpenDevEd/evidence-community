"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon, LanguageSkillIcon, Login01Icon, Menu01Icon, Moon02Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { useTranslations } from "next-intl";
import { DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger } from "@nextui-org/react";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Button } from "@/components/nextui/Button";
import { useRuntimeLocaleNavigation } from "@/hooks/useRuntimeLocaleNavigation";
import { useTheme } from "next-themes";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/routing";
import LoginButton from "./LoginButton";
import { languageMenuItems, languageName, useLibraryLanguages } from "./LanguageSwitcher";
import type { NavbarContext } from "@/types/navbar";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useReaderLinks, useReaderSession } from "./ReaderSession";
import { ReaderAvatar, readerMenuGroups } from "./UserMenu";
import {
	NavbarMenuIcon,
	NavbarMenuSwitch,
	navbarMenuClasses,
	navbarMenuDropdownClasses,
	navbarMenuItemClasses,
	navbarMenuSectionClasses,
	navbarMenuSignInClasses,
} from "./menuStyles";

const KEEPS_MENU_OPEN = new Set(["theme", "language", "back"]);

/** The popover box around the menu, whose height changes between views. */
function menuFrame(menu: HTMLElement | null) {
	return menu?.closest<HTMLElement>('[data-slot="content"]') ?? null;
}

interface ActionsDropdownProps {
	context: NavbarContext;
	/**
	 * Off where the Sign in button sits beside the menu: the menu then holds the
	 * library's settings only, behind a settings button. Signed in, the avatar
	 * opens everything either way.
	 */
	includeSignIn?: boolean;
}

type Translate = ReturnType<typeof useTranslations<"ui">>;

/**
 * The menu shows either its actions or, one step in, the list of languages.
 * The rows slide in from the side they come from while the menu frame eases
 * from the old view's height to the new one's. The same menu stays mounted,
 * so the popover never replays its opening.
 */
function useSteppedMenu() {
	const [view, setView] = useState<"main" | "languages">("main");
	// Which way the last step went; none when the menu has just opened.
	const [step, setStep] = useState<"forward" | "back" | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const menuRef = useRef<HTMLUListElement>(null);
	const heightBeforeStep = useRef<number | null>(null);
	const setOpen = (open: boolean) => {
		setIsOpen(open);
		// Opening again starts from the actions, not where it was left.
		if (!open) {
			setView("main");
			setStep(null);
		}
	};
	const goTo = (next: "main" | "languages") => {
		heightBeforeStep.current = menuFrame(menuRef.current)?.offsetHeight ?? null;
		setStep(next === "languages" ? "forward" : "back");
		setView(next);
	};

	// DOM animation, so a layout effect.
	useLayoutEffect(() => {
		const from = heightBeforeStep.current;
		heightBeforeStep.current = null;
		const list = menuRef.current;
		const frame = menuFrame(list);
		if (from === null || !list || !frame || !step) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const rtl = getComputedStyle(list).direction === "rtl";
		const offset = (step === "forward" ? 16 : -16) * (rtl ? -1 : 1);
		const timing = { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
		const rows = list.animate(
			[
				{ opacity: 0, transform: `translateX(${offset}px)` },
				{ opacity: 1, transform: "translateX(0)" },
			],
			timing,
		);
		const to = frame.offsetHeight;
		const height =
			to === from
				? null
				: frame.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], timing);
		return () => {
			rows.cancel();
			height?.cancel();
		};
	}, [view, step]);

	return { menuRef, view, isOpen, setOpen, goTo };
}

/** The library's settings: dark mode as a switch, and the step into languages. */
function settingsItems(input: {
	t: Translate;
	hasTheme: boolean;
	hasLanguages: boolean;
	isDark: boolean;
	currentLocale: string;
	onToggleTheme: () => void;
	onLanguages: () => void;
}) {
	const { t } = input;
	const items = [];
	if (input.hasTheme) {
		items.push(
			<DropdownItem
				key="theme"
				onPress={input.onToggleTheme}
				startContent={<NavbarMenuIcon icon={Moon02Icon} />}
				endContent={<NavbarMenuSwitch on={input.isDark} />}
				textValue={t("darkMode")}
			>
				{t("darkMode")}
			</DropdownItem>,
		);
	}
	if (input.hasLanguages) {
		items.push(
			<DropdownItem
				key="language"
				onPress={input.onLanguages}
				startContent={<NavbarMenuIcon icon={LanguageSkillIcon} />}
				endContent={
					<span className="flex items-center gap-1 text-small text-foreground/60 dark:text-white/60">
						{languageName(input.currentLocale)}
						<NavbarMenuIcon icon={ArrowRight01Icon} className="size-4 rtl:rotate-180" />
					</span>
				}
				textValue={t("language")}
			>
				{t("language")}
			</DropdownItem>,
		);
	}
	return items;
}

/** Who is signed in and their account, then the settings, then signing in or out. */
function menuSections(input: {
	t: Translate;
	groups: ReturnType<typeof readerMenuGroups> | null;
	settings: ReturnType<typeof settingsItems>;
	hasLogin: boolean;
	onSignIn: () => void;
}) {
	const { t, groups, settings, hasLogin } = input;
	const sections = [];
	if (groups) {
		sections.push(
			<DropdownSection key="reader" showDivider classNames={navbarMenuSectionClasses}>
				{groups.identity}
			</DropdownSection>,
			<DropdownSection key="account" showDivider classNames={navbarMenuSectionClasses}>
				{groups.account}
			</DropdownSection>,
		);
	}
	if (settings.length > 0) {
		sections.push(
			<DropdownSection key="settings" showDivider={Boolean(groups) || hasLogin} classNames={navbarMenuSectionClasses}>
				{settings}
			</DropdownSection>,
		);
	}
	if (groups) {
		sections.push(
			<DropdownSection key="sign-out" classNames={navbarMenuSectionClasses}>
				{groups.signOut}
			</DropdownSection>,
		);
	} else if (hasLogin) {
		sections.push(
			<DropdownSection key="sign-in" classNames={navbarMenuSectionClasses}>
				<DropdownItem
					key="login"
					onPress={input.onSignIn}
					startContent={<HugeiconsIcon icon={Login01Icon} aria-hidden className="size-5 shrink-0" />}
					className={navbarMenuSignInClasses}
				>
					{t("signIn")}
				</DropdownItem>
			</DropdownSection>,
		);
	}
	return sections;
}

/** Signed out, a menu button; with Sign in kept beside it, a settings button. */
function menuButton(t: Translate, includeSignIn: boolean) {
	return (
		<Button
			variant="invisible"
			disableRipple
			isIconOnly
			className="flex items-center justify-center"
			aria-label={includeSignIn ? t("actionsMenuAriaLabel") : t("settings")}
		>
			<HugeiconsIcon icon={includeSignIn ? Menu01Icon : Settings02Icon} className="size-5 text-accent" />
		</Button>
	);
}

/** One step into the menu: back to the actions, then the library's languages. */
function languageSections(input: {
	t: Translate;
	languages: ReturnType<typeof useLibraryLanguages>;
	currentLocale: string;
	onBack: () => void;
	onSelect: ReturnType<typeof useRuntimeLocaleNavigation>;
}) {
	return [
		<DropdownSection key="languages-back" showDivider classNames={navbarMenuSectionClasses}>
			<DropdownItem
				key="back"
				onPress={input.onBack}
				startContent={<NavbarMenuIcon icon={ArrowLeft01Icon} className="rtl:rotate-180" />}
				className="font-semibold"
			>
				{input.t("language")}
			</DropdownItem>
		</DropdownSection>,
		<DropdownSection key="languages" classNames={navbarMenuSectionClasses}>
			{languageMenuItems({ locales: input.languages, current: input.currentLocale, onSelect: input.onSelect })}
		</DropdownSection>,
	];
}

/**
 * The header's actions when they do not fit beside the links: who is signed
 * in and their account first, then the library's settings, then signing in or
 * out. Each group is one section, so the dividers are the only gaps.
 */
export default function ActionsDropdown({ context, includeSignIn = true }: ActionsDropdownProps) {
	const { reader } = useReaderSession();
	const languages = useLibraryLanguages();
	const hasTheme = useLibraryFeature("themeSwitcher");
	const hasLanguages = useLibraryFeature("languageSwitcher") && languages.length > 1;
	const hasReaderAccounts = useLibraryFeature("readerAccounts");
	const hasLogin = hasReaderAccounts && !reader && includeSignIn;

	// Theme and language always sit in a menu; Sign in alone is a button.
	if (!reader && !hasTheme && !hasLanguages) {
		return hasLogin ? <LoginButton variant="inline" styleVariant={context.styleVariant} /> : null;
	}
	return (
		<ActionsMenu
			includeSignIn={includeSignIn}
			hasTheme={hasTheme}
			hasLanguages={hasLanguages}
			hasLogin={hasLogin}
			hasProfiles={hasReaderAccounts}
			languages={languages}
		/>
	);
}

function ActionsMenu({
	includeSignIn,
	hasTheme,
	hasLanguages,
	hasLogin,
	hasProfiles,
	languages,
}: {
	includeSignIn: boolean;
	hasProfiles: boolean;
	hasTheme: boolean;
	hasLanguages: boolean;
	hasLogin: boolean;
	languages: ReturnType<typeof useLibraryLanguages>;
}) {
	const t = useTranslations("ui");
	const { reader, signIn, signOut } = useReaderSession();
	const links = useReaderLinks();
	const { resolvedTheme: theme, setTheme } = useTheme();
	const router = useRouter();
	const currentLocale = useLocale();
	const changeLocale = useRuntimeLocaleNavigation();
	const { menuRef, view, isOpen, setOpen, goTo } = useSteppedMenu();
	const isDark = theme === "dark";
	const settings = settingsItems({
		t,
		hasTheme,
		hasLanguages,
		isDark,
		currentLocale,
		onToggleTheme: () => setTheme(isDark ? "light" : "dark"),
		onLanguages: () => goTo("languages"),
	});
	const groups = reader
		? readerMenuGroups({
				reader,
				t,
				links,
				onProfile: hasProfiles ? () => router.push(`/profile/${reader.id}`) : undefined,
				onSignOut: signOut,
			})
		: null;
	const shown =
		view === "languages"
			? languageSections({ t, languages, currentLocale, onBack: () => goTo("main"), onSelect: changeLocale })
			: menuSections({ t, groups, settings, hasLogin, onSignIn: signIn });

	return (
		<Dropdown
			placement="bottom-end"
			classNames={navbarMenuDropdownClasses}
			isOpen={isOpen}
			// Opening it asks again whether they're on the team, as the desktop menu does.
			onOpenChange={(open) => { setOpen(open); if (open) links.refreshTeam(); }}
			closeOnSelect={false}
		>
			<DropdownTrigger>{reader ? <ReaderAvatar reader={reader} asTrigger /> : menuButton(t, includeSignIn)}</DropdownTrigger>
			<DropdownMenu
				ref={menuRef}
				aria-label={t("actionsMenuAriaLabel")}
				classNames={navbarMenuClasses}
				itemClasses={navbarMenuItemClasses}
				// Settings and the step into languages keep the menu open; everything else is done once chosen.
				onAction={(key) => {
					if (!KEEPS_MENU_OPEN.has(String(key))) setOpen(false);
				}}
			>
				{shown}
			</DropdownMenu>
		</Dropdown>
	);
}
