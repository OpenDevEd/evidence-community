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
	getCitationsByYear
} from "./index";
import { withMeilisearchCache } from "@/lib/cache-utils";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";

export async function getComprehensiveStats(): Promise<ComprehensiveStats> {
	const config = await getLibraryConfig();
	return withMeilisearchCache(`${config.revision}-comprehensive-stats`, async () => {
		const db = await getDatabaseForConfig(config);
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
			citationsByYear
		] = await Promise.all([
			getInstitutionStats(db),
			getInstitutionStatsByYear(db),
			getAvailableYears(db),
			getItemTypeStats(db, totalItems),
			getYearDistribution(db),
			getCitationStats(db),
			getCreatorStats(db),
			getFieldCompleteness(db, totalItems),
			getAttachmentStats(db, totalItems),
			getPublishersAndJournals(db),
			getRecentActivity(db),
			getAuthorCountries(db),
			getAuthorProductivityStats(db),
			getAuthorCollaborationStats(db),
			getDetailedAuthorStats(db),
			getTopicStats(db),
			getTopicStatsByYear(db),
			getCitationsByYear(db)
		]);

		const collaborationStats = await getCollaborationStats(db, authorCountries);

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
			languageDistribution: publishersAndJournals.languageDistribution,
			recentActivity,
			topicStats: topicData.topicStats,
			topicOverview: topicData.topicOverview,
			citationsByYear
		};
	});
}
