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
		console.log("📊 Checking cached statistics...");
		const statsResult = await meilisearch
			.index(index)
			.getDocument(documentId);
		console.log("✅ Found cached statistics");
		return JSON.parse(statsResult.content);
	} catch (error) {
		console.log("🔄 No cached statistics found, generating fresh data...");
		await ensureCacheIndexExists(index);

		const startTime = Date.now();

		// Execute all queries in parallel where possible
		console.log("🚀 Starting comprehensive statistics generation...");

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

		const totalTime = Date.now() - startTime;
		console.log(`🎉 All statistics calculated! Total time: ${totalTime}ms`);
		console.log(`📈 Final stats: ${detailedAuthorStats.length} detailed authors, ${authorProductivityStats.totalAuthors.toLocaleString()} total authors, ${authorCollaborationStats.collaborationRate}% collaboration rate, ${topicData.topicStats.length} topics`);

		console.log("💾 Caching statistics to Meilisearch...");
		const cacheStart = Date.now();
		await meilisearch.index(index).addDocuments([
			{
				id: documentId,
				content: JSON.stringify(comprehensiveStats),
			},
		]);
		console.log(`✅ Statistics cached in ${Date.now() - cacheStart}ms`);
		
		return comprehensiveStats;
	}
} 