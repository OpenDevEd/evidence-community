import { valueFormatter } from "@/lib/items";
import { columnLabels } from "@/db/schema/views/columns";
import { twMerge } from "tailwind-merge";
import type { Item } from "@/app/api/item/types";
import { useTranslations } from "next-intl";

export default function ItemRow({ item, row }: { item: Item; row: string }) {
	const t = useTranslations("article");
	const originalValue = item[row as keyof Item];
	const rowName = t(row);
	const rowValue = valueFormatter[row]
		? valueFormatter[row]!(originalValue, item) : (originalValue ? String(originalValue) : "N/A");

	if (!rowValue || !originalValue) return null;

	return (
		<div className="flex">
			<h3
				className={twMerge(
					"text-xl font-medium text-black/60 dark:text-white/60 xl:w-64 w-24 shrink-0 rounded",
					!rowName && "!text-red-500",
					rowValue === undefined && "bg-red-500 text-center"
				)}
			>
				{rowName || row}
			</h3>
			<div className="text-lg text-black/80 dark:text-white/80 font-medium break-words w-full">
				{rowValue ? rowValue : "N/A"}
			</div>
		</div>
	);
}