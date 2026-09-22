"use client";

import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import CopyButton from "@/components/features/newlib/CopyButton";

export function ItemPropertyRowWrapper({
	children,
	title,
	copyText,
	className,
	actions,
}: {
	children: React.ReactNode;
	title: string;
	copyText?: string;
	className?: string;
	actions?: React.ReactNode;
}) {
	const tUI = useTranslations("ui");
	return (
		<div className={twMerge("flex flex-col gap-4", className)}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="text-xl font-medium">{title}</h3>
				{actions}
				{copyText && (
					<CopyButton
						textToCopy={copyText}
						ariaLabel={tUI("copyField", { field: title })}
					/>
				)}
			</div>
			{children}
		</div>
	);
}
