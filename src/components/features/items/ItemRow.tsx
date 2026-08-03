import { valueFormatter } from "@/lib/items";
import { twMerge } from "tailwind-merge";
import type { Item } from "@/app/api/item/types";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import React from "react";
import { Tooltip } from "@nextui-org/react";
import { AiFillQuestionCircle } from "react-icons/ai";
import { useQueryState } from "nuqs";
import { resolveCitationDisplayMode } from "@/lib/citationMode.mts";
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
	// DOI-only items render a DOI anchor instead of a formatted citation and
	// usually have no stored `citation` value, so the citation row must not be
	// gated on `originalValue` in that mode.
	const citationDisplayMode =
		row === "citation" && !customRowName
			? resolveCitationDisplayMode(item)
			: null;
	const rendersDoiOnlyCitation =
		citationDisplayMode?.mode === "doi-only" && !!citationDisplayMode.link;
	if (!rowValue || (!originalValue && !rendersDoiOnlyCitation)) return null;
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
				{tooltip && <Tooltip content={tooltip}><AiFillQuestionCircle className="size-6 hover:opacity-100 opacity-50 transition-opacity" /></Tooltip>}
			</h3>	
			{React.createElement(element, {
				suppressHydrationWarning: true,
				className: "text-lg text-black/80 dark:text-white/80 font-medium whitespace-normal w-full [overflow-wrap:anywhere]"
			}, rowValue ? rowValue : "N/A")}
		</div>
	);
}