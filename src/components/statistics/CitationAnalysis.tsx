import { useTranslations } from "next-intl";
import { BsGraphUp } from "react-icons/bs";
import { SectionCard } from "./SectionCard";
import { CitationStats } from "./types";

type CitationAnalysisProps = {
	citationStats: CitationStats;
};

export function CitationAnalysis({ citationStats }: CitationAnalysisProps) {
	const t = useTranslations("ui");

	return (
		<SectionCard title={t("citationAnalysis")} icon={BsGraphUp}>
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
				<div className="text-center p-6 rounded-xl bg-success/10">
					<div className="text-3xl font-bold text-success mb-2">
						{citationStats.itemsWithCitations.toLocaleString()}
					</div>
					<div className="text-sm text-black/60 dark:text-white/60">
						{t("itemsWithCitations")}
					</div>
				</div>
				<div className="text-center p-6 rounded-xl bg-accent/10">
					<div className="text-3xl font-bold text-accent mb-2">
						{citationStats.avgCitationsPerItem.toFixed(2)}
					</div>
					<div className="text-sm text-black/60 dark:text-white/60">
						{t("averageCitationsPerItem")}
					</div>
				</div>
				<div className="text-center p-6 rounded-xl bg-tertiary/10">
					<div className="text-3xl font-bold text-tertiary mb-2">
						{citationStats.maxCitations.toLocaleString()}
					</div>
					<div className="text-sm text-black/60 dark:text-white/60">
						{t("highestCitationCount")}
					</div>
				</div>
				<div className="text-center p-6 rounded-xl bg-purple-500/10">
					<div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
						{citationStats.hIndex}
					</div>
					<div className="text-sm text-black/60 dark:text-white/60">
						H-Index
					</div>
				</div>
			</div>
		</SectionCard>
	);
} 