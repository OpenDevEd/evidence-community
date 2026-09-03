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
	const citationMeasureLabel = (
		option: (typeof stats.citationMeasure.options)[number],
	) =>
		option.kind === "library"
			? t("libraryCitations")
			: `${option.sourceLabel} ${t("citationsLowercase")}`;

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
				<InternationalCollaboration
					collaborationStats={stats.collaborationStats}
				/>

				{/* Language Distribution */}
				<LanguageDistribution
					languageDistribution={stats.languageDistribution}
				/>

				{/* Institutions Table */}
				{stats.institutions &&
					stats.institutionsByYear &&
					stats.authorCountries &&
					stats.availableYears && (
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
				{stats.authorStats &&
					stats.authorProductivityStats &&
					stats.authorCollaborationStats && (
					<AuthorAnalytics 
						authorStats={stats.authorStats}
							authorProductivityStats={
								stats.authorProductivityStats
							}
							authorCollaborationStats={
								stats.authorCollaborationStats
							}
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