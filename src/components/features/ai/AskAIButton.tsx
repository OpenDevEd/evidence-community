"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { SparklesIcon } from "@hugeicons/core-free-icons";

/** Hands whatever is in a question or search field to the assistant. */
export function AskAIButton({ hint, onAsk }: { hint: string; onAsk: () => void }) {
	const tAI = useTranslations("ai");
	const [revealed, setRevealed] = useState(false);
	// Firefox needs a painted frame before the entrance begins.
	useEffect(() => {
		let revealFrame = 0;
		const paintFrame = requestAnimationFrame(() => {
			revealFrame = requestAnimationFrame(() => setRevealed(true));
		});
		return () => {
			cancelAnimationFrame(paintFrame);
			cancelAnimationFrame(revealFrame);
		};
	}, []);
	if (!revealed) return null;

	return (
		// A plain button: press handling inside the search field's own
		// content breaks the one the rest of the site uses.
		<button
			type="button"
			onMouseDown={(event) => event.preventDefault()}
			onClick={onAsk}
			// Smaller on a phone, where the search field is shorter and
			// there is no keyboard to show a shortcut for.
			className="flex h-7 shrink-0 animate-rise-in items-center gap-1 self-center rounded-lg bg-accent px-2.5 text-xs font-medium text-white transition-transform hover:scale-102 active:scale-97 motion-reduce:animate-none lg:h-9 lg:gap-1.5 lg:rounded-[10px] lg:pl-3 lg:pr-1.5 lg:text-sm"
		>
			<HugeiconsIcon icon={SparklesIcon} className="size-3.5 shrink-0 lg:size-4" />
			{tAI("askAI")}
			<kbd className="ml-0.5 hidden rounded-md bg-white/20 px-1.5 py-0.5 font-sans text-citation font-medium leading-none text-white/90 lg:inline">
				{hint}
			</kbd>
		</button>
	);
}
