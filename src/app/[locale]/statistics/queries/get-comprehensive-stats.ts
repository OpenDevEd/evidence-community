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

export async function getComprehensiveStats(): Promise<ComprehensiveStats> {
	return withMeilisearchCache("comprehensive-stats", async () => {
		const totalItems = await getTotalItems();

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
			getInstitutionStats(),
			getInstitutionStatsByYear(),
			getAvailableYears(),
			getItemTypeStats(totalItems),
			getYearDistribution(),
			getCitationStats(),
			getCreatorStats(),
			getFieldCompleteness(totalItems),
			getAttachmentStats(totalItems),
			getPublishersAndJournals(),
			getRecentActivity(),
			getAuthorCountries(),
			getAuthorProductivityStats(),
			getAuthorCollaborationStats(),
			getDetailedAuthorStats(),
			getTopicStats(),
			getTopicStatsByYear(),
			getCitationsByYear()
		]);

		const collaborationStats = await getCollaborationStats(authorCountries);

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
