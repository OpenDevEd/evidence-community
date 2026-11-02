import { Progress } from "@/components/nextui/Progress";
import { useTranslations, useLocale } from "next-intl";

type ProgressItemProps = {
	label: string;
	value: number;
	percentage: number;
	total: number;
};

export function ProgressItem({
	label,
	value,
	percentage,
	total,
}: ProgressItemProps) {
  const locale = useLocale();
	const t = useTranslations("ui");
	const tArticle = useTranslations("article");
	
	return (
		<div className="space-y-3">
			<div className="flex justify-between items-center">
				<span className="text-sm font-medium text-black dark:text-white">
					{tArticle(label)}
				</span>
				<span className="text-xs text-black/60 dark:text-white/60">
					{percentage.toFixed(1)}%
				</span>
			</div>
			<Progress
				value={percentage}
				color="primary"
				size="sm"
				className="w-full"
				classNames={{
					track: "bg-black/10 dark:bg-white/10",
					indicator: "bg-accent",
				}}
			/>
			<div className="flex justify-between text-xs text-black/40 dark:text-white/40">
				<span>
					{value.toLocaleString(locale)} {t("itemsLowercase")}
				</span>
				<span>
					{t("of")} {total.toLocaleString(locale)}
				</span>
			</div>
		</div>
	);
} 