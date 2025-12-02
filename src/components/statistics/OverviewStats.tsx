import { useTranslations } from "next-intl";
import { BsFileText, BsQuote, BsActivity, BsPeople, BsBuilding, BsPaperclip } from "react-icons/bs";
import { StatCard } from "./StatCard";
import { ComprehensiveStats } from "./types";

type OverviewStatsProps = {
	stats: ComprehensiveStats;
};

export function OverviewStats({ stats }: OverviewStatsProps) {
	const t = useTranslations("ui");

	return (
		<div className="space-y-6">
			{/* Primary Stats */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
				<StatCard
					title={t("totalItems")}
					value={stats.citationStats.totalItems}
					subtitle={t("inDatabase")}
					icon={BsFileText}
					color="accent"
				/>
				<StatCard
					title={t("totalCitations")}
					value={stats.citationStats.totalCitations}
					subtitle={`${stats.citationStats.citationPercentage}% ${t("haveCitations")}`}
					icon={BsQuote}
					color="success"
				/>
				<StatCard
					title="H-Index"
					value={stats.citationStats.hIndex}
					subtitle={t("globalImpactMetric")}
					icon={BsActivity}
					color="tertiary"
				/>
				<StatCard
					title={t("uniqueCreators")}
					value={stats.creatorStats.uniqueCreators}
					subtitle={`${t("avg")} ${stats.creatorStats.avgCreatorsPerItem.toFixed(1)} ${t("perItem")}`}
					icon={BsPeople}
					color="card"
				/>
			</div>

			{/* Secondary Stats */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<StatCard
					title={t("institutions")}
					value={stats.institutions.length}
					subtitle={t("uniqueInstitutions")}
					icon={BsBuilding}
					color="accent"
				/>
				<StatCard
					title={t("attachments")}
					value={stats.attachmentStats.totalAttachments}
					subtitle={`${stats.attachmentStats.attachmentPercentage}% ${t("ofItemsHaveAttachments")}`}
					icon={BsPaperclip}
					color="success"
				/>
			</div>
		</div>
	);
} 