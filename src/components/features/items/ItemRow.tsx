import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { valueFormatter } from "@/lib/items";
import { twMerge } from "@/lib/tw-merge";
import type { Item } from "@/app/api/item/types";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import React from "react";
import { Tooltip } from "@/components/nextui/Tooltip";
import { useQueryState } from "nuqs";
export default function ItemRow({ item, row, router, value, customRowName, loading, tooltip, pathname }: { item: Item; row?: string; router: ReturnType<typeof useRouter>, value?: any, customRowName?: string, loading: boolean, tooltip?: string, pathname: string }) {
	const t = useTranslations();
	const formatter = useFormatter();
	const originalValue = value ?? item[row as keyof Item];
	let element = "div";
	const rowValue: any = (() => {
		switch (true) {
			case !!customRowName:
				return originalValue;
			case !!valueFormatter[row as keyof typeof valueFormatter]:
				return valueFormatter[row as keyof typeof valueFormatter]!({value: originalValue, item, formatter, t, router, loading, pathname});
			case !!originalValue:
				element = "p"
				return String(originalValue);
			default:
				return "N/A";
		}
	})();
	if (!rowValue || !originalValue) return null;
	const rowName = customRowName || t("article." + row);

	return (
		<div className="flex lg:flex-row flex-col lg:gap-4">
			<h3
				className={twMerge(
					"text-xl font-medium text-black/60 dark:text-white/60 lg:w-64 w-full shrink-0 rounded flex gap-2",
					!rowName && "!text-red-500",
					rowValue === undefined && "bg-red-500 text-center"
				)}
			>
				{rowName || row}
				{tooltip && <Tooltip color="default" content={tooltip}><HugeiconsIcon icon={HelpCircleIcon} className="size-6 hover:opacity-100 opacity-50 transition-opacity" /></Tooltip>}
			</h3>	
			{React.createElement(element, {
				suppressHydrationWarning: true,
				className: "text-lg text-black/80 dark:text-white/80 font-medium whitespace-normal w-full [overflow-wrap:anywhere]"
			}, rowValue ? rowValue : "N/A")}
		</div>
	);
}