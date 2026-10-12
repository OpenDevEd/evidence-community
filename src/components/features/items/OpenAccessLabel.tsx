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
}: {
	openAccess: boolean | null | undefined;
	className?: string;
	iconClassName?: string;
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
			{t(shown ? "openAccess" : "closedAccess")}
		</span>
	);
}
