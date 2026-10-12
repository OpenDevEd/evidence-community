"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Hint } from "@/components/nextui/Tooltip";

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
		<Hint
			content={t("futurePublicationDate")}
			contentClassName="max-w-72 py-2 text-sm"
			className={className}
		>
			{children}
		</Hint>
	);
}
