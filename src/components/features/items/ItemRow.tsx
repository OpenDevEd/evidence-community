import { valueFormatter } from "@/lib/items";
import { twMerge } from "tailwind-merge";
import type { Item } from "@/app/api/item/types";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";

export default function ItemRow({ item, row, router }: { item: Item; row: string; router: ReturnType<typeof useRouter> }) {
	const t = useTranslations();
	const formatter = useFormatter();
	const originalValue = item[row as keyof Item];
	const rowValue = valueFormatter[row]
	? valueFormatter[row]!({value: originalValue, item, formatter, t, router}) : (originalValue ? String(originalValue) : "N/A");
	if (!rowValue || !originalValue) return null;
	const rowName = t("article." + row);

	return (
		<div className="flex xl:flex-row flex-col gap-4">
			<h3
				className={twMerge(
					"text-xl font-medium text-black/60 dark:text-white/60 xl:w-64 w-full shrink-0 rounded",
					!rowName && "!text-red-500",
					rowValue === undefined && "bg-red-500 text-center"
				)}
			>
				{rowName || row}
			</h3>
			<div suppressHydrationWarning className="text-lg text-black/80 dark:text-white/80 font-medium break-words w-full">
				{rowValue ? rowValue : "N/A"}
			</div>
		</div>
	);
}