"use client";

import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
import OpenScholar from "@/components/icons/OpenScholar";
import { useOpenScholarUrl } from "@/components/layout/navbar/ReaderSession";

/** "Powered by OpenScholar" attribution under the chat composer and in the footer. Its logo scales with the text. */
export function PoweredByOpenScholar({ className }: { className?: string }) {
	const t = useTranslations("ai");
	const openScholar = useOpenScholarUrl();
	return (
		<a
			href={openScholar()}
			target="_blank"
			rel="noopener noreferrer"
			className={twMerge(
				"inline-flex items-center gap-1.5 text-[11px] text-black/40 transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70",
				className,
			)}
		>
			{t("poweredBy")}
			<OpenScholar className="size-[1.3em] shrink-0" aria-hidden />
			<span className="font-semibold">
				OpenScholar<span className="font-medium opacity-70">.ai</span>
			</span>
		</a>
	);
}
