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
import { getCachedCollections } from "@/app/api/cache";
import type { Collection } from "@/app/api/collections/types";
import type { ShownCollections } from "./topic-stats";

/** Part of the cache key: raise it when the statistics change what they count, so a deployment never serves figures cached by the code before it. */
const STATISTICS_VERSION = 3;

export async function getComprehensiveStats(
	requestedCitationMeasure?: string,
): Promise<ComprehensiveStats> {
	const config = await getLibraryConfig();
	const db = await getDatabaseForConfig(config);
	const { measure, options } = await resolveCitationMeasure(
		db,
		requestedCitationMeasure,
	);
	// No fallback: statistics computed without the collections would be cached with every topic missing.
	const shown = shownCollections(await getCachedCollections(config));
	const stats = await withMeilisearchCache(
		config,
		`${config.revision}-comprehensive-stats-v${STATISTICS_VERSION}-${measure.key}`,
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
				getTopicStats(db, measure, shown),
				getTopicStatsByYear(db, measure, shown),
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

/**
 * Every collection the library shows, nested ones included, by key with its public name and parent. A shown root is
 * named by its configured title; the hierarchy copies that title onto every collection below it, so those go by their
 * own names.
 */
function shownCollections(collections: readonly Collection[]): ShownCollections {
	const shown = new Map<string, { title: string; parent?: string }>();
	const visit = (list: readonly Collection[]) => {
		for (const collection of list) {
			const title = collection.parentCollection ? collection.name : collection.title || collection.name;
			shown.set(collection.key, { title: title || collection.key, parent: collection.parentCollection || undefined });
			if (collection.children?.length) visit(collection.children);
		}
	};
	visit(collections);
	return shown;
}
