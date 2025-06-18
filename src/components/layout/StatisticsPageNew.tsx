"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
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

export default function StatisticsPage({ stats }: StatisticsPageProps) {
	"use no memo";
	const t = useTranslations("ui");

	return (
		<PageContainer className="space-y-8">
			<motion.div
				initial="hidden"
				animate="show"
				variants={containerVariants}
				className="space-y-8"
			>
				{/* Header */}
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
				</motion.div>

				{/* Overview Stats */}
				<OverviewStats stats={stats} />

				{/* Data Completeness */}
				<DataCompleteness stats={stats} />

				{/* Item Types & Years */}
				<ItemTypesAndYears stats={stats} />

				{/* Citation Analysis */}
				<CitationAnalysis citationStats={stats.citationStats} />

				{/* Citations by Year */}
				{stats.citationsByYear && stats.citationsByYear.length > 0 && (
					<CitationsByYear 
						citationsByYear={stats.citationsByYear}
						institutionsByYear={stats.institutionsByYear}
						topicsByYear={stats.topicsByYear}
					/>
				)}

				{/* International Collaboration */}
				<InternationalCollaboration collaborationStats={stats.collaborationStats} />

				{/* Language Distribution */}
				<LanguageDistribution languageDistribution={stats.languageDistribution} />

				{/* Institutions Table */}
				{stats.institutions && stats.institutionsByYear && stats.authorCountries && stats.availableYears && (
					<InstitutionsTable 
						institutions={stats.institutions}
						institutionsByYear={stats.institutionsByYear}
						availableYears={stats.availableYears}
						authorCountries={stats.authorCountries}
					/>
				)}

				{/* Author Countries */}
				{stats.authorCountries && stats.creatorStats && (
					<AuthorCountries 
						authorCountries={stats.authorCountries}
						creatorStats={stats.creatorStats}
					/>
				)}

				{/* Author Analytics */}
				{stats.authorStats && stats.authorProductivityStats && stats.authorCollaborationStats && (
					<AuthorAnalytics 
						authorStats={stats.authorStats}
						authorProductivityStats={stats.authorProductivityStats}
						authorCollaborationStats={stats.authorCollaborationStats}
					/>
				)}

				{/* Research Topics */}
				{stats.topicStats && stats.topicOverview && (
					<ResearchTopics 
						topicStats={stats.topicStats}
						topicOverview={stats.topicOverview}
						topicsByYear={stats.topicsByYear}
					/>
				)}

				{/* Top Journals */}
				{stats.topJournals && stats.topJournals.length > 0 && (
					<TopJournals topJournals={stats.topJournals} />
				)}

				{/* Recent Activity */}
				{stats.recentActivity && stats.recentActivity.length > 0 && (
					<RecentActivity recentActivity={stats.recentActivity} />
				)}
			</motion.div>
		</PageContainer>
	);
} 