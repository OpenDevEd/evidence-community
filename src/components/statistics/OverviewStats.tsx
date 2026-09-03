import {
	Activity01Icon,
	Attachment01Icon,
	Building02Icon,
	File02Icon,
	QuoteUpIcon,
	UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { StatCard } from "./StatCard";
import { ComprehensiveStats } from "./types";

type OverviewStatsProps = {
	stats: ComprehensiveStats;
};

export function OverviewStats({ stats }: OverviewStatsProps) {
	const t = useTranslations("ui");
	const selectedCitationMeasure = stats.citationMeasure.options.find(
		(option) => option.key === stats.citationMeasure.selectedKey,
	);
	const citationTitle =
		selectedCitationMeasure?.kind === "source"
			? `${selectedCitationMeasure.sourceLabel} ${t("citationsLowercase")}`
			: t("libraryCitations");

	return (
		<div className="space-y-6">
			{/* Primary Stats */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
				<StatCard
					title={t("totalItems")}
					value={stats.citationStats.totalItems}
					subtitle={t("inDatabase")}
					icon={File02Icon}
					color="accent"
				/>
				<StatCard
					title={citationTitle}
					value={stats.citationStats.totalCitations}
					subtitle={`${stats.citationStats.citationPercentage}% ${t("haveCitations")}`}
					icon={QuoteUpIcon}
					color="success"
				/>
				<StatCard
					title="H-Index"
					value={stats.citationStats.hIndex}
					subtitle={t("globalImpactMetric")}
					icon={Activity01Icon}
					color="tertiary"
				/>
				<StatCard
					title={t("uniqueCreators")}
					value={stats.creatorStats.uniqueCreators}
					subtitle={`${t("avg")} ${stats.creatorStats.avgCreatorsPerItem.toFixed(1)} ${t("perItem")}`}
					icon={UserGroupIcon}
					color="card"
				/>
			</div>

			{/* Secondary Stats */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<StatCard
					title={t("institutions")}
					value={stats.institutions.length}
					subtitle={t("uniqueInstitutions")}
					icon={Building02Icon}
					color="accent"
				/>
				<StatCard
					title={t("attachments")}
					value={stats.attachmentStats.totalAttachments}
					subtitle={`${stats.attachmentStats.attachmentPercentage}% ${t("ofItemsHaveAttachments")}`}
					icon={Attachment01Icon}
					color="success"
				/>
			</div>
		</div>
	);
} 