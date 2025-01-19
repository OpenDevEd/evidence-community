import { valueFormatter } from "@/lib/items";
import { twMerge } from "tailwind-merge";
import type { Item } from "@/app/api/item/types";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";

export default function ItemRow({ item, row, router, value, customRowName }: { item: Item; row?: string; router: ReturnType<typeof useRouter>, value?: any, customRowName?: string }) {
	const t = useTranslations();
	const formatter = useFormatter();
	const originalValue = value ?? item[row as keyof Item];
	const rowValue: any = (() => {
		switch (true) {
			case !!customRowName:
				return originalValue;
			case !!valueFormatter[row as keyof typeof valueFormatter]:
				return valueFormatter[row as keyof typeof valueFormatter]!({value: originalValue, item, formatter, t, router});
			case !!originalValue:
				return String(originalValue);
			default:
				return "N/A";
		}
	})();
	if (!rowValue || !originalValue) return null;
	const rowName = customRowName || t("article." + row);

	return (
		<div className="flex xl:flex-row flex-col xl:gap-4">
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