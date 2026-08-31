import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { SectionCard } from "./SectionCard";
import { ProgressItem } from "./ProgressItem";
import { ComprehensiveStats } from "./types";

type DataCompletenessProps = {
	stats: ComprehensiveStats;
};

export function DataCompleteness({ stats }: DataCompletenessProps) {
	const t = useTranslations("ui");

	return (
		<SectionCard title={t("dataCompleteness")} icon={CheckmarkCircle01Icon}>
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
				{stats.fieldCompleteness.map((field, index) => (
					<ProgressItem
						key={index}
						label={field.field}
						value={field.filledCount}
						percentage={field.percentage}
						total={stats.citationStats.totalItems}
					/>
				))}
			</div>
		</SectionCard>
	);
} 