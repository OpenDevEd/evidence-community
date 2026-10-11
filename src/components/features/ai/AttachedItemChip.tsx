"use client";

import { BookOpen01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { Link } from "@/i18n/routing";
import type { AttachedItem } from "./AskAbout";

/**
 * The publication a question is about: above the message box while it is
 * attached, removable there, and on the question once it is sent.
 */
export function AttachedItemChip({ item, onRemove }: { item: AttachedItem; onRemove?: () => void }) {
	const t = useTranslations("ai");
	return (
		<span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-accent/10 pl-2.5 pr-1 text-sm text-black/80 dark:text-white/80">
			<HugeiconsIcon icon={BookOpen01Icon} className="size-3.5 shrink-0 text-accent" aria-hidden />
			<Link href={`/lib/${item.key}`} target="_blank" rel="noopener noreferrer" className="min-w-0 rounded-sm outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent">
				<TruncatedText text={item.title} className="max-w-[28rem]" />
			</Link>
			{onRemove ? (
				<button
					type="button"
					aria-label={t("removeAttached", { title: item.title })}
					onClick={onRemove}
					className="grid size-5 shrink-0 place-items-center rounded-full text-black/50 outline-none transition-colors hover:bg-black/10 hover:text-black focus-visible:ring-2 focus-visible:ring-accent dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
				>
					<HugeiconsIcon icon={Cancel01Icon} className="size-3" aria-hidden />
				</button>
			) : (
				<span className="w-1.5" />
			)}
		</span>
	);
}
