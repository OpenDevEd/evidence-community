"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import PageContainer from "./PageContainer";
import {
	ComprehensiveStats,
	OverviewStats,
	DataCompleteness,
	ItemTypesAndYears,
	CitationAnalysis,
	InternationalCollaboration,
	LanguageDistribution,
	RecentActivity,
	InstitutionsTable,
	TopJournals,
	AuthorCountries,
	AuthorAnalytics,
	ResearchTopics,
	CitationsByYear,
} from "@/components/statistics";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

type StatisticsPageProps = {
	stats: ComprehensiveStats;
};

const containerVariants = {
	hidden: { opacity: 0 },
	show: {
		opacity: 1,
		transition: {
			staggerChildren: 0.1,
		},
	},
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

type SectionProps = { stats: ComprehensiveStats };

function StatisticsHeader({ stats }: SectionProps) {
	const t = useTranslations("ui");
	const citationMeasureLabel = (
		option: (typeof stats.citationMeasure.options)[number],
	) =>
		option.kind === "library"
			? t("libraryCitations")
			: `${option.sourceLabel} ${t("citationsLowercase")}`;

	return (
		<motion.div
			variants={itemVariants}
			className="text-center space-y-4"
		>
			<h1 className="text-4xl font-bold text-black dark:text-white">
				{t("databaseStatistics")}
			</h1>
			<p className="text-lg text-black/60 dark:text-white/60 max-w-2xl mx-auto">
				{t("databaseStatisticsDescription")}
			</p>
			{stats.citationMeasure.options.length > 1 && (
				<nav
					aria-label={t("citationMeasure")}
					className="mx-auto flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-black/10 bg-black/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04]"
				>
					{stats.citationMeasure.options.map((option) => {
						const selected =
							option.key ===
							stats.citationMeasure.selectedKey;
						return (
							<Link
								key={option.key}
								href={`/statistics?citation=${encodeURIComponent(option.key)}`}
								aria-current={
									selected ? "page" : undefined
								}
								className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
									selected
										? "bg-white text-black shadow-sm dark:bg-white/15 dark:text-white"
										: "text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white"
								}`}
							>
								{citationMeasureLabel(option)}
							</Link>
						);
					})}
				</nav>
			)}
		</motion.div>
	);
}

function CitationsByYearSection({
	stats,
	topicsEnabled,
}: SectionProps & { topicsEnabled: boolean }) {
	if (!hasRows(stats.citationsByYear)) return null;
	return (
		<CitationsByYear 
			citationsByYear={stats.citationsByYear}
			institutionsByYear={stats.institutionsByYear}
			topicsByYear={topicsEnabled ? stats.openAlexTopicsByYear : []}
		/>
	);
}

function InstitutionsSection({ stats }: SectionProps) {
	const shown = [
		stats.institutions,
		stats.institutionsByYear,
		stats.authorCountries,
		stats.availableYears,
	].every(Boolean);
	if (!shown) return null;
	return (
		<InstitutionsTable 
			institutions={stats.institutions}
			institutionsByYear={stats.institutionsByYear}
			availableYears={stats.availableYears}
			authorCountries={stats.authorCountries}
		/>
	);
}

/** Its averages divide by the countries, so no countries, no section. */
function AuthorCountriesSection({ stats }: SectionProps) {
	if (!hasRows(stats.authorCountries) || !stats.creatorStats) return null;
	return (
		<AuthorCountries 
			authorCountries={stats.authorCountries}
			creatorStats={stats.creatorStats}
		/>
	);
}

function AuthorAnalyticsSection({ stats }: SectionProps) {
	if (
		!stats.authorStats ||
		!stats.authorProductivityStats ||
		!stats.authorCollaborationStats
	) {
		return null;
	}
	return (
		<AuthorAnalytics 
			authorStats={stats.authorStats}
			authorProductivityStats={stats.authorProductivityStats}
			authorCollaborationStats={stats.authorCollaborationStats}
		/>
	);
}

/** The collections the library shows; none shown, no section. */
function CollectionsSection({ stats }: SectionProps) {
	if (!hasRows(stats.topicStats) || !stats.topicOverview) return null;
	return (
		<ResearchTopics 
			kind="collections"
			topicStats={stats.topicStats}
			topicOverview={stats.topicOverview}
			topicsByYear={stats.collectionsByYear}
		/>
	);
}

function OpenAlexTopicsSection({
	stats,
	topicsEnabled,
}: SectionProps & { topicsEnabled: boolean }) {
	if (
		!topicsEnabled ||
		!hasRows(stats.openAlexTopicStats) ||
		!stats.openAlexTopicOverview
	) {
		return null;
	}
	return (
		<ResearchTopics
			topicStats={stats.openAlexTopicStats}
			topicOverview={stats.openAlexTopicOverview}
			topicsByYear={stats.openAlexTopicsByYear}
		/>
	);
}

export default function StatisticsPage({ stats }: StatisticsPageProps) {
	"use no memo";
	const { topics } = useLibraryConfig();

	return (
		<PageContainer className="space-y-8">
			<motion.div
				initial="hidden"
				animate="show"
				variants={containerVariants}
				className="space-y-8"
			>
				<StatisticsHeader stats={stats} />

				{/* Overview Stats */}
				<OverviewStats stats={stats} />

				{/* Data Completeness */}
				<DataCompleteness stats={stats} />

				{/* Item Types & Years */}
				<ItemTypesAndYears stats={stats} />

				{/* Citation Analysis */}
				<CitationAnalysis citationStats={stats.citationStats} />

				<CitationsByYearSection
					stats={stats}
					topicsEnabled={topics.enabled}
				/>

				{/* International Collaboration */}
				<InternationalCollaboration
					collaborationStats={stats.collaborationStats}
				/>

				{/* Language Distribution */}
				<LanguageDistribution
					languageDistribution={stats.languageDistribution}
				/>

				<InstitutionsSection stats={stats} />
				<AuthorCountriesSection stats={stats} />
				<AuthorAnalyticsSection stats={stats} />
				<CollectionsSection stats={stats} />
				<OpenAlexTopicsSection
					stats={stats}
					topicsEnabled={topics.enabled}
				/>

				{/* Top Journals */}
				{hasRows(stats.topJournals) && (
					<TopJournals topJournals={stats.topJournals} />
				)}

				{/* Recent Activity */}
				{hasRows(stats.recentActivity) && (
					<RecentActivity recentActivity={stats.recentActivity} />
				)}
			</motion.div>
		</PageContainer>
	);
}

/** A section of rows with none to show says nothing, so it is left out. */
function hasRows(rows: readonly unknown[] | null | undefined): rows is readonly unknown[] {
	return Boolean(rows?.length);
}
