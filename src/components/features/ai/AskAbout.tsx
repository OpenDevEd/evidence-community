"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SparklesIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/nextui/Button";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";

/** A publication handed to the chat, so the reader can see what a question is about. */
export type AttachedItem = { key: string; title: string };

/**
 * Hands a publication to the chat the page has: the one beside the results on
 * the library page, the full-screen one elsewhere. Pages with no chat, such as
 * the admin, or a library with AI off, have none, and no button asks.
 */
const AskAboutContext = createContext<((item: AttachedItem) => void) | null>(null);

export const AskAboutProvider = AskAboutContext;

export function useAskAbout() {
	return useContext(AskAboutContext);
}

export function attachedItem(item: { key?: string | null; title?: string | null } | undefined): AttachedItem | null {
	return item?.key ? { key: item.key, title: item.title || "Untitled publication" } : null;
}

/** Ask AI about one publication: a labelled button on a card, an icon in a hover card. */
export function AskAboutButton({ item, compact = false, onAsked }: { item: { key?: string | null; title?: string | null } | undefined; compact?: boolean; /** After handing the publication over, such as closing the hover card it was in. */ onAsked?: () => void }) {
	const askAbout = useAskAbout();
	const t = useTranslations("ai");
	const attached = attachedItem(item);
	if (!askAbout) return null;
	const icon = <HugeiconsIcon icon={SparklesIcon} className="size-3.5 shrink-0" />;
	// A card still loading shows the button disabled, so its row of buttons is its final width before the record arrives.
	if (!attached) return compact ? null : <CardButton icon={icon} label={t("askAI")} />;
	if (compact) {
		return (
			<button
				type="button"
				onClick={() => {
					askAbout(attached);
					onAsked?.();
				}}
				className="inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-citation font-medium leading-none text-accent outline-none transition-colors hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent"
			>
				{icon}
				{t("askAI")}
			</button>
		);
	}
	return <CardButton icon={icon} label={t("askAI")} onPress={() => askAbout(attached)} />;
}

// Shortcut: icon-only below 720 px with no tooltip, as the card's Copy link button is; give both one when the card gets tooltips.
function CardButton({ icon, label, onPress }: { icon: ReactNode; label: string; /** None while the card is loading. */ onPress?: () => void }) {
	return (
		<Button
			size="sm"
			aria-label={label}
			isDisabled={!onPress}
			onPress={onPress}
			className="min-w-0 aspect-square px-0 @[720px]:aspect-auto @[720px]:px-3"
			startContent={icon}
		>
			<span className="hidden @[720px]:inline">{label}</span>
		</Button>
	);
}
