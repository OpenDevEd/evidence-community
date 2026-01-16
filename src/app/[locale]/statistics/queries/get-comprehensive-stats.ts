import meilisearch from "@/lib/meilisearch";
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
import { ensureCacheIndexExists } from "@/lib/cache-utils";

export async function getComprehensiveStats(ignore: boolean): Promise<ComprehensiveStats> {
	const index = "cache";
	const documentId = process.env.MEILI_INDEX + "-comprehensive-stats";

	try {
		if (ignore) {
			throw new Error("Ignore");
		}
		const statsResult = await meilisearch
			.index(index)
			.getDocument(documentId);
		return JSON.parse(statsResult.content);
	} catch (error) {
		await ensureCacheIndexExists(index);

		// Execute all queries in parallel where possible

		// Basic stats that other queries depend on
		const totalItems = await getTotalItems();
		
		// Execute independent queries in parallel
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

		// Execute dependent queries
		const collaborationStats = await getCollaborationStats(authorCountries);

		const comprehensiveStats: ComprehensiveStats = {
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

		await meilisearch.index(index).addDocuments([
			{
				id: documentId,
				content: JSON.stringify(comprehensiveStats),
			},
		]);
		
		return comprehensiveStats;
	}
} 