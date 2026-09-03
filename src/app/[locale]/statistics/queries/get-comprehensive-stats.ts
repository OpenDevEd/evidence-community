import {
	type ComprehensiveStats,
	getInstitutionStats,
	getInstitutionStatsByYear,
	getTotalItems,
	getAvailableYears,
	getItemTypeStats,
	getYearDistribution,
	getCitationStats,
	getCreatorStats,
	getFieldCompleteness,
	getAttachmentStats,
	getPublishersAndJournals,
	getRecentActivity,
	getAuthorCountries,
	getAuthorProductivityStats,
	getAuthorCollaborationStats,
	getDetailedAuthorStats,
	getCollaborationStats,
	getTopicStats,
	getTopicStatsByYear,
	getCitationsByYear,
} from "./index";
import { withMeilisearchCache } from "@/lib/cache-utils";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { resolveCitationMeasure } from "./citation-measure";

export async function getComprehensiveStats(
	requestedCitationMeasure?: string,
): Promise<ComprehensiveStats> {
	const config = await getLibraryConfig();
	const db = await getDatabaseForConfig(config);
	const { measure, options } = await resolveCitationMeasure(
		db,
		requestedCitationMeasure,
	);
	const stats = await withMeilisearchCache(
		config,
		`${config.revision}-comprehensive-stats-${measure.key}`,
		async () => {
			const totalItems = await getTotalItems(db);

			const [
				institutions,
				institutionsByYear,
				availableYears,
				itemTypes,
				yearDistribution,
				citationStats,
				creatorStats,
				fieldCompleteness,
				attachmentStats,
				publishersAndJournals,
				recentActivity,
				authorCountries,
				authorProductivityStats,
				authorCollaborationStats,
				detailedAuthorStats,
				topicData,
				topicsByYear,
				citationsByYear,
			] = await Promise.all([
				getInstitutionStats(db, measure),
				getInstitutionStatsByYear(db, measure),
				getAvailableYears(db),
				getItemTypeStats(db, totalItems),
				getYearDistribution(db),
				getCitationStats(db, measure),
				getCreatorStats(db),
				getFieldCompleteness(db, totalItems),
				getAttachmentStats(db, totalItems),
				getPublishersAndJournals(db),
				getRecentActivity(db),
				getAuthorCountries(db, measure),
				getAuthorProductivityStats(db),
				getAuthorCollaborationStats(db),
				getDetailedAuthorStats(db, measure),
				getTopicStats(db, measure),
				getTopicStatsByYear(db, measure),
				getCitationsByYear(db, measure),
			]);

			const collaborationStats = await getCollaborationStats(
				db,
				authorCountries,
			);

			return {
				institutions,
				institutionsByYear,
				topicsByYear,
				availableYears,
				itemTypes,
				yearDistribution,
				citationStats,
				creatorStats,
				fieldCompleteness,
				attachmentStats,
				authorCountries,
				collaborationStats,
				authorStats: detailedAuthorStats,
				authorProductivityStats,
				authorCollaborationStats,
				topPublishers: publishersAndJournals.topPublishers,
				topJournals: publishersAndJournals.topJournals,
				languageDistribution:
					publishersAndJournals.languageDistribution,
				recentActivity,
				topicStats: topicData.topicStats,
				topicOverview: topicData.topicOverview,
				citationsByYear,
			};
		},
	);
	return {
		...stats,
		citationMeasure: { selectedKey: measure.key, options },
	};
}
