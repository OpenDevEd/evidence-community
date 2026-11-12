"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import type { NavbarActionSlot } from "@/lib/navbar-actions";
import { HEADER_SLIDE_MS } from "@/lib/readers/session-follow";
import type { NavbarContext } from "@/types/navbar";

import ActionsDropdown from "./ActionsDropdown";
import LoginButton from "./LoginButton";
import ThemeSwitcher from "./ThemeSwitcher";

/** One control in the header's actions, signed out. */
function ActionSlot({ slot, context }: { slot: NavbarActionSlot; context: NavbarContext }) {
	const { styleVariant } = context;
	switch (slot.kind) {
		case "theme":
			return <ThemeSwitcher variant="inline" styleVariant={styleVariant} />;
		case "settingsMenu":
			return <ActionsDropdown context={context} includeSignIn={false} />;
		case "signIn":
			return <LoginButton variant="inline" styleVariant={styleVariant} />;
		case "menu":
			return <ActionsDropdown context={context} />;
	}
}

/**
 * One step's actions. When the reader changes while the page is open (a community follows the OpenScholar session,
 * `ReaderSession.tsx`), the avatar and the Sign in button are different widths: the step slides from the old width
 * to the new one, and the links beside it slide with it, instead of jumping. The outside system is the browser's
 * layout, which alone knows both widths.
 */
function ActionsStep({ step, label, reader, children }: { step: number; label: string; reader: string | null; children: ReactNode }) {
	const nav = useRef<HTMLElement>(null);
	const lastWidth = useRef<number | null>(null);
	useLayoutEffect(() => {
		const element = nav.current;
		if (!element) return;
		const width = element.getBoundingClientRect().width;
		const from = lastWidth.current;
		lastWidth.current = width;
		// Nothing to slide from on the first frame, in a step the bar isn't showing, or for someone who asked for less motion.
		if (!from || !width || from === width || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const slide = element.animate([{ width: `${from}px`, overflow: "hidden" }, { width: `${width}px`, overflow: "hidden" }], { duration: HEADER_SLIDE_MS, easing: "ease-out" });
		return () => slide.cancel();
	}, [reader]);
	return (
		<nav ref={nav} className={`nf-step nf-step-${step} items-center justify-end gap-6`} aria-label={label}>
			{children}
		</nav>
	);
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
			<ActionsStep key={step} step={step} label={t("secondaryNavAriaLabel")} reader={context.session?.id ?? null}>
				{context.session ? (
					<ActionsDropdown context={context} />
				) : (
					slots.map((slot) => (
						<ActionSlot key={slot.kind} slot={slot} context={context} />
					))
				)}
			</ActionsStep>
		) : null,
	);
}
