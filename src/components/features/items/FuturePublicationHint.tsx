"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Tooltip } from "@/components/nextui/Tooltip";
import { twMerge } from "@/lib/tw-merge";

/** Explains, on hover, why a publication date is later than today. */
export function FuturePublicationHint({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const t = useTranslations("ui");
	return (
		<Tooltip
			content={t("futurePublicationDate")}
			className="max-w-72 py-2 text-sm"
		>
			<span
				className={twMerge(
					"inline-flex cursor-help items-center gap-1.5",
					className,
				)}
			>
				{children}
			</span>
		</Tooltip>
	);
}
