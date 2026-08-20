"use client";

import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import OpenScholar from "@/components/icons/OpenScholar";

/** Small "Powered by OpenScholar" attribution shown under the chat composer. */
export function PoweredByOpenScholar({ className }: { className?: string }) {
	const t = useTranslations("ai");
	return (
		<a
			href="https://openscholar.ai"
			target="_blank"
			rel="noopener noreferrer"
			className={twMerge(
				"inline-flex items-center gap-1.5 text-[11px] text-black/40 transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70",
				className,
			)}
		>
			{t("poweredBy")}
			<OpenScholar className="size-3.5 shrink-0" aria-hidden />
			<span className="font-semibold">
				OpenScholar<span className="font-medium opacity-70">.ai</span>
			</span>
		</a>
	);
}
