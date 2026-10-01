"use client";

import { useTranslations } from "next-intl";

import type { NavbarActionSlot } from "@/lib/navbar-actions";
import type { NavbarContext } from "@/types/navbar";

import ActionsDropdown from "./ActionsDropdown";
import LanguageSwitcher from "./LanguageSwitcher";
import LoginButton from "./LoginButton";
import ThemeSwitcher from "./ThemeSwitcher";

/** One control in the header's actions, signed out. */
function ActionSlot({ slot, context }: { slot: NavbarActionSlot; context: NavbarContext }) {
	const { styleVariant } = context;
	switch (slot.kind) {
		case "setting":
			return slot.setting === "theme" ? (
				<ThemeSwitcher variant="inline" styleVariant={styleVariant} />
			) : (
				<LanguageSwitcher variant="inline" styleVariant={styleVariant} />
			);
		case "settingsMenu":
			return <ActionsDropdown context={context} includeSignIn={false} />;
		case "signIn":
			return <LoginButton variant="inline" styleVariant={styleVariant} />;
		case "menu":
			return <ActionsDropdown context={context} />;
	}
}

/**
 * The header's actions beside the links, one arrangement per step from
 * `navbarActionSteps`. The bar's measured container queries show the widest
 * that fits (src/lib/navbar-fit.ts). Signed in, the avatar holds everything.
 */
export default function NavbarActionSteps({ steps, context }: { steps: NavbarActionSlot[][]; context: NavbarContext }) {
	const t = useTranslations("ui");
	return steps.map((slots, step) =>
		context.session || slots.length > 0 ? (
			<nav key={step} className={`nf-step nf-step-${step} items-center gap-6`} aria-label={t("secondaryNavAriaLabel")}>
				{context.session ? (
					<ActionsDropdown context={context} />
				) : (
					slots.map((slot) => (
						<ActionSlot key={slot.kind === "setting" ? slot.setting : slot.kind} slot={slot} context={context} />
					))
				)}
			</nav>
		) : null,
	);
}
