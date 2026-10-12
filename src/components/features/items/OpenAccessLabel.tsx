"use client";

import { LockKeyholeIcon, LockKeyholeOpenIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { shownOpenAccess } from "@/lib/open-access";
import { twMerge } from "@/lib/tw-merge";

/** Says whether a record is open access, as far as the library's `content.openAccessLabel` asks it to. */
export function OpenAccessLabel({
	openAccess,
	className,
	iconClassName,
	iconOnly = false,
}: {
	openAccess: boolean | null | undefined;
	className?: string;
	iconClassName?: string;
	/** The icon alone, for a citation link; the words stay for screen readers. */
	iconOnly?: boolean;
}) {
	const { content } = useLibraryConfig();
	const t = useTranslations("ui");
	const shown = shownOpenAccess(openAccess, content.openAccessLabel);
	if (shown === null) return null;
	return (
		<span
			className={twMerge(
				"inline-flex shrink-0 items-center gap-1.5 font-medium",
				shown ? "text-success-700 dark:text-success-400" : "text-black/60 dark:text-white/60",
				className,
			)}
		>
			<HugeiconsIcon
				icon={shown ? LockKeyholeOpenIcon : LockKeyholeIcon}
				className={twMerge("size-4 shrink-0", iconClassName)}
				aria-hidden="true"
			/>
			<span className={iconOnly ? "sr-only" : undefined}>{t(shown ? "openAccess" : "closedAccess")}</span>
		</span>
	);
}
