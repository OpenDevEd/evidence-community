"use client";

// Opens records, a search or a collection of this library in OpenScholar (src/lib/openscholar/handoff.ts), where the
// reader screens or extracts from them on their own account.

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useReadLocalStorage } from "usehooks-ts";

import OpenScholar from "@/components/icons/OpenScholar";
import { toast } from "@/components/layout/Toast";
import { Button } from "@/components/nextui/Button";
import type { OpenScholarHandoff } from "@/lib/openscholar/handoff";
import type { SmartScreeningField } from "@/types/ai";

/** The Smart screening questions the reader keeps in this browser, which a hand-off takes along. */
export function useSmartScreeningFields() {
	return useReadLocalStorage<SmartScreeningField[]>("smart-screening-fields") ?? [];
}

/** Makes the hand-off (src/app/api/handoff) and answers its address in OpenScholar. */
async function handOff(handoff: OpenScholarHandoff) {
	const response = await fetch("/api/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(handoff) });
	const answer: { url?: string; error?: string } | null = await response.json().catch(() => null);
	if (!response.ok || !answer?.url) throw new Error(answer?.error ?? `HTTP ${response.status}`);
	return answer.url;
}

/** `header` looks like the chat's Copy and Export beside it (components/features/modals/AIControls.tsx). */
export function OpenInOpenScholar({ handoff, label, appearance = "default" }: { handoff: () => OpenScholarHandoff; label: string; appearance?: "default" | "header" }) {
	const t = useTranslations("ui");
	// The new tab takes the reader's eye at once, so the button shows nothing while it works; a second press waits.
	const opening = useRef(false);
	const header = appearance === "header";
	const open = async () => {
		if (opening.current) return;
		opening.current = true;
		// The tab opens inside the click, so the browser allows it, and goes to OpenScholar once the hand-off is made.
		const tab = window.open("", "_blank");
		if (tab) tab.opener = null;
		try {
			const url = await handOff(handoff());
			if (tab) tab.location.href = url;
			else window.location.assign(url);
		} catch (error) {
			tab?.close();
			console.error("[library sources] opening in Openscholar failed", error);
			toast({ type: "error", title: t("openInOpenScholarFailed"), description: t("tryAgainLater") });
		} finally {
			opening.current = false;
		}
	};
	return (
		<Button
			{...(header ? { size: "sm" as const, variant: "transparent" as const, className: "h-8 min-w-0 gap-1.5 rounded-2xl px-2.5 text-sm text-black/65 hover:bg-black/5 dark:text-white/65 dark:hover:bg-white/10" } : {})}
			endContent={<OpenScholar aria-hidden className={header ? "size-4 shrink-0" : "size-5 shrink-0"} />}
			onPress={open}
		>
			{label}
		</Button>
	);
}
