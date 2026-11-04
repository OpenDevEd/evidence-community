import { Activity01Icon } from "@hugeicons/core-free-icons";
import { useTranslations, useFormatter, useLocale } from "next-intl";
import { SectionCard } from "./SectionCard";

type RecentActivityProps = {
	recentActivity: { date: string; count: number }[];
};

export function RecentActivity({ recentActivity }: RecentActivityProps) {
  const locale = useLocale();
	const t = useTranslations("ui");
	const formatter = useFormatter();

	if (recentActivity.length === 0) {
		return null;
	}

	return (
		<SectionCard title={t("recentActivity")} icon={Activity01Icon}>
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{recentActivity.map((activity, index) => (
					<div
						key={index}
						className="flex justify-between items-center p-3 rounded-xl bg-black/5 dark:bg-white/5"
					>
						<span className="font-medium text-black dark:text-white">
							{formatter.dateTime(
								new Date(activity.date),
								{
									month: "short",
									day: "numeric",
								}
							)}
						</span>
						<span className="font-bold text-tertiary">
							{activity.count.toLocaleString(locale)}
						</span>
					</div>
				))}
			</div>
		</SectionCard>
	);
} 